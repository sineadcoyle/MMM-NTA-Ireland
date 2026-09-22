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
      return
    }

    if (notification === "NTA_FETCH_DEPARTURES") {
      await this.fetchDepartures()
    }
  },

  async fetchDepartures() {
    try {
      this.validateConfig()

      const feed = await this.fetchJsonFeed()
      const departures = extractDepartures(feed, this.config)

      this.sendSocketNotification("NTA_DEPARTURES", { departures })
    } catch (error) {
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

      const request = https.get(url, {
        headers: {
          "accept": "application/json",
          "x-api-key": this.config.apiKey,
        },
        timeout: 20000,
      }, (response) => {
        let body = ""

        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          body += chunk
        })

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`NTA API returned HTTP ${response.statusCode}`))
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
})
