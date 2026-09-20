const https = require("https")
const NodeHelper = require("node_helper")

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
      const departures = this.extractDepartures(feed)

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

  extractDepartures(feed) {
    const stopConfigById = this.getStopConfigById()
    const stopIds = new Set(Object.keys(stopConfigById))
    const entities = this.asArray(feed.entity || feed.entities)
    const departures = []
    const nowSeconds = Math.floor(Date.now() / 1000)
    const windowSeconds = (this.config.departureWindowMinutes || 120) * 60

    entities.forEach((entity) => {
      const tripUpdate = entity.tripUpdate || entity.trip_update

      if (!tripUpdate) {
        return
      }

      const trip = tripUpdate.trip || {}
      const stopTimeUpdates = this.asArray(tripUpdate.stopTimeUpdate || tripUpdate.stop_time_update)

      stopTimeUpdates.forEach((stopTimeUpdate) => {
        const stopId = this.value(stopTimeUpdate.stopId, stopTimeUpdate.stop_id)

        if (!stopIds.has(stopId)) {
          return
        }

        const departure = this.getStopTimeEvent(stopTimeUpdate.departure) || this.getStopTimeEvent(stopTimeUpdate.arrival)

        if (!departure.time) {
          return
        }

        if (departure.time < nowSeconds || departure.time > nowSeconds + windowSeconds) {
          return
        }

        departures.push({
          stopId,
          stopName: stopConfigById[stopId].name || "",
          route: this.cleanRouteId(this.value(trip.routeId, trip.route_id)),
          destination: this.value(stopTimeUpdate.stopHeadsign, stopTimeUpdate.stop_headsign, trip.tripHeadsign, trip.trip_headsign),
          scheduledTime: departure.scheduledTime,
          realtimeTime: departure.time,
          delaySeconds: departure.delaySeconds,
          cancelled: this.isCancelled(stopTimeUpdate, trip),
        })
      })
    })

    return departures
      .filter(departure => !departure.cancelled)
      .sort((first, second) => first.realtimeTime - second.realtimeTime)
      .slice(0, this.config.maxDepartures)
  },

  getStopConfigById() {
    return this.config.stops.reduce((stops, stop) => {
      if (typeof stop === "string") {
        stops[stop] = { id: stop, name: "" }
        return stops
      }

      const id = this.value(stop.id, stop.code, stop.stopId, stop.stop_id)

      if (id) {
        stops[id] = { ...stop, id }
      }

      return stops
    }, {})
  },

  getStopTimeEvent(event) {
    if (!event) {
      return null
    }

    const time = Number(this.value(event.time, event.Time))
    const delaySeconds = Number(this.value(event.delay, event.Delay, 0))

    if (!Number.isFinite(time)) {
      return null
    }

    return {
      time,
      scheduledTime: Number.isFinite(time - delaySeconds) ? time - delaySeconds : time,
      delaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : 0,
    }
  },

  isCancelled(stopTimeUpdate, trip) {
    const relationship = this.value(
      stopTimeUpdate.scheduleRelationship,
      stopTimeUpdate.schedule_relationship,
      trip.scheduleRelationship,
      trip.schedule_relationship,
    )

    return relationship === "SKIPPED" || relationship === "CANCELED" || relationship === "CANCELLED"
  },

  cleanRouteId(routeId) {
    if (!routeId) {
      return ""
    }

    return String(routeId)
      .replace(/^routes:/i, "")
      .replace(/^route:/i, "")
  },

  asArray(value) {
    if (!value) {
      return []
    }

    return Array.isArray(value) ? value : [value]
  },

  value(...values) {
    return values.find(value => value !== undefined && value !== null && value !== "")
  },
})
