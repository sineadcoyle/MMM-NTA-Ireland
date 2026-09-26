const fs = require("fs")
const os = require("os")
const path = require("path")
const https = require("https")
const { execFile } = require("child_process")
const { promisify } = require("util")
const NodeHelper = require("node_helper")
const { extractDepartures } = require("./lib/departures")
const { loadStaticGtfs } = require("./lib/static-gtfs")

const execFileAsync = promisify(execFile)

const REALTIME_API_URL = "https://api.nationaltransport.ie/gtfsr/v2/gtfsr"
const STATIC_GTFS_URL = "https://www.transportforireland.ie/transitData/google_transit.zip"

module.exports = NodeHelper.create({

  start() {
    this.config = null
    this.staticGtfs = null
    this.staticGtfsLoadedAt = 0
  },

  async socketNotificationReceived(notification, payload) {
    if (notification === "NTA_CONFIG") {
      this.config = payload
      this.log(`Configuration received: stops=${this.getConfiguredStopIds().length}, apiKey=${this.config.apiKey ? "set" : "missing"}`)
      return
    }

    if (notification === "NTA_FETCH_DEPARTURES") {
      await this.fetchDepartures()
    }
  },

  async fetchDepartures() {
    this.log("Fetching departures")

    try {
      this.validateConfig()

      const feed = await this.fetchJsonFeed()
      const staticGtfs = await this.ensureStaticGtfs()
      const config = this.resolveStopCodes(staticGtfs.stopCodeToId)
      const entityCount = Array.isArray(feed.entity)
        ? feed.entity.length
        : Array.isArray(feed.entities) ? feed.entities.length : 0
      const departures = extractDepartures(feed, config, Date.now(), staticGtfs.scheduledTimes)

      this.log(`Feed parsed: entities=${entityCount}, matchingDepartures=${departures.length}`)
      this.sendSocketNotification("NTA_DEPARTURES", { departures })
    } catch (error) {
      console.error(`[MMM-NTA-Ireland] Fetch failed: ${error.message}`)
      this.sendSocketNotification("NTA_ERROR", { message: error.message })
    }
  },

  validateConfig() {
    if (!this.config) {
      throw new Error("Missing module configuration")
    }

    if (!this.config.apiKey) {
      throw new Error("Missing NTA API key")
    }

    if (!Array.isArray(this.config.stops) || this.config.stops.length === 0) {
      throw new Error("Configure at least one bus stop")
    }
  },

  async ensureStaticGtfs() {
    const refreshInterval = this.config.timetableRefreshInterval || 24 * 60 * 60 * 1000
    if (this.staticGtfs && Date.now() - this.staticGtfsLoadedAt < refreshInterval) {
      return this.staticGtfs
    }

    const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mmm-nta-gtfs-"))

    try {
      const archivePath = path.join(temporaryDirectory, "static-gtfs.zip")
      await this.downloadFile(STATIC_GTFS_URL, archivePath)
      await execFileAsync("unzip", ["-o", "-q", archivePath, "-d", temporaryDirectory])

      this.staticGtfs = loadStaticGtfs(temporaryDirectory)
      this.staticGtfsLoadedAt = Date.now()
      this.log(`Static GTFS loaded: trip/stop schedules=${this.staticGtfs.scheduledTimes.size}, stop codes=${this.staticGtfs.stopCodeToId.size}`)
      return this.staticGtfs
    } finally {
      if (temporaryDirectory) {
        await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
      }
    }
  },

  downloadFile(fileUrl, destination, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      const request = https.get(fileUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          if (redirectCount >= 5) {
            reject(new Error("Static GTFS download followed too many redirects"))
            return
          }

          this.downloadFile(new URL(response.headers.location, fileUrl), destination, redirectCount + 1)
            .then(resolve)
            .catch(reject)
          return
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume()
          reject(new Error(`Static GTFS returned HTTP ${response.statusCode}`))
          return
        }

        const output = fs.createWriteStream(destination)
        response.pipe(output)
        output.on("finish", () => output.close(resolve))
        output.on("error", reject)
      })

      request.setTimeout(60000, () => request.destroy(new Error("Static GTFS request timed out")))
      request.on("error", reject)
    })
  },

  fetchJsonFeed() {
    return new Promise((resolve, reject) => {
      const url = new URL(REALTIME_API_URL)
      url.searchParams.set("format", "json")

      this.log(`Requesting ${url.toString()}`)
      const request = https.get(url, {
        headers: {
          "accept": "application/json",
          "x-api-key": this.config.apiKey,
        },
        timeout: 20000,
      }, (response) => {
        let body = ""

        console.log(`[MMM-NTA-Ireland] NTA API response: HTTP ${response.statusCode}, content-type=${response.headers["content-type"] || "unknown"}`)
        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          body += chunk
        })

        response.on("end", () => {
          this.log(`NTA API response body received: ${Buffer.byteLength(body, "utf8")} bytes`)

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const responsePreview = body.replace(/\s+/g, " ").slice(0, 200)
            reject(new Error(`NTA API returned HTTP ${response.statusCode}${responsePreview ? `: ${responsePreview}` : ""}`))
            return
          }

          try {
            resolve(JSON.parse(body))
          } catch (error) {
            reject(new Error(`Unable to parse NTA API response: ${error.message}`))
          }
        })
      })

      request.on("timeout", () => {
        request.destroy(new Error("NTA API request timed out"))
      })

      request.on("error", (error) => {
        reject(error)
      })
    })
  },

  getConfiguredStopIds() {
    return (this.config?.stops || []).map((stop) => {
      if (typeof stop === "string") {
        return stop
      }

      return stop?.id || stop?.code || stop?.stopId || stop?.stop_id
    }).filter(Boolean)
  },

  resolveStopCodes(stopCodeToId) {
    return {
      ...this.config,
      stops: (this.config.stops || []).map((stop) => {
        const configuredId = typeof stop === "string"
          ? null
          : stop?.id || stop?.stopId || stop?.stop_id
        const configuredCode = typeof stop === "string"
          ? stop
          : stop?.code
        const resolvedId = configuredId || stopCodeToId.get(configuredCode) || configuredCode || stop

        return typeof stop === "string" ? resolvedId : { ...stop, id: resolvedId }
      }),
    }
  },

  log(message) {
    if (this.config?.debug) {
      console.log(`[MMM-NTA-Ireland] ${message}`)
    }
  },
})
