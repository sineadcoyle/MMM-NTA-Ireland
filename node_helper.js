const https = require("https")
const NodeHelper = require("node_helper")
const { extractDepartures } = require("./lib/departures")

module.exports = NodeHelper.create({

  start() {
    this.config = null
  },

  async socketNotificationReceived(notification, payload) {
    if (notification === "NTA_CONFIG") {
      this.config = payload
      this.log(`Configuration received: apiUrl=${this.config.apiUrl}, stops=${this.getConfiguredStopIds().length}, apiKey=${this.config.apiKey ? "set" : "missing"}`)
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
      const entityCount = Array.isArray(feed.entity)
        ? feed.entity.length
        : Array.isArray(feed.entities) ? feed.entities.length : 0
      const departures = extractDepartures(feed, this.config)

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

  fetchJsonFeed() {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.apiUrl)
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

  log(message) {
    if (this.config?.debug) {
      console.log(`[MMM-NTA-Ireland] ${message}`)
    }
  },
})
