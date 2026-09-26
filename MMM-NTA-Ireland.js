Module.register("MMM-NTA-Ireland", {

  defaults: {
    apiKey: "",
    timetableRefreshInterval: 24 * 60 * 60 * 1000,
    debug: false,
    stops: [],
    maxDepartures: 5,
    refreshInterval: 60 * 1000,
    animationSpeed: 1000,
    fade: true,
    fadePoint: 0.25,
    timeFormat: "relative",
    showStopName: true,
    showRoute: true,
    showDestination: true,
    showDelay: true,
    showCancelled: false,
    moduleHeader: "Bus departures",
    loadingMessage: "Loading departures…",
    noDeparturesMessage: "No upcoming bus departures",
    errorMessage: "Unable to load bus departures"
  },

  getStyles() {
    return ["MMM-NTA-Ireland.css"]
  },

  start() {
    Log.info(`Starting module: ${this.name}`)

    this.departures = []
    this.error = null
    this.loaded = false
    this.scheduleTimer = null

    this.sendSocketNotification("NTA_CONFIG", this.config)
    this.fetchDepartures()
  },

  suspend() {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer)
      this.scheduleTimer = null
    }
  },

  resume() {
    this.fetchDepartures()
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "NTA_DEPARTURES") {
      this.loaded = true
      this.error = null
      this.departures = payload.departures || []
      this.log(`Received ${this.departures.length} departures`)
      this.updateDom(this.config.animationSpeed)
      this.scheduleNextFetch()
    }

    if (notification === "NTA_ERROR") {
      this.loaded = true
      this.error = payload.message || this.config.errorMessage
      console.error(`[MMM-NTA-Ireland] ${this.error}`)
      this.updateDom(this.config.animationSpeed)
      this.scheduleNextFetch()
    }
  },

  getDom() {
    const wrapper = document.createElement("div")
    wrapper.className = "nta-wrapper"

    if (this.config.moduleHeader) {
      const header = document.createElement("header")
      header.className = "nta-header"
      header.textContent = this.config.moduleHeader
      wrapper.appendChild(header)
    }

    if (!this.loaded) {
      wrapper.appendChild(this.createMessage(this.config.loadingMessage, "dimmed"))
      return wrapper
    }

    if (this.error) {
      wrapper.appendChild(this.createMessage(this.error, "dimmed nta-error"))
      return wrapper
    }

    if (this.departures.length === 0) {
      wrapper.appendChild(this.createMessage(this.config.noDeparturesMessage, "dimmed"))
      return wrapper
    }

    const table = document.createElement("table")
    table.className = "small nta-departures"

    this.departures.slice(0, this.config.maxDepartures).forEach((departure, index) => {
      table.appendChild(this.createDepartureRow(departure, index))
    })

    wrapper.appendChild(table)
    return wrapper
  },

  createDepartureRow(departure, index) {
    const row = document.createElement("tr")
    row.className = departure.cancelled ? "nta-departure nta-cancelled" : "nta-departure"

    if (this.config.fade && this.config.fadePoint < 1) {
      const fadeIndex = Math.max(this.config.maxDepartures * this.config.fadePoint, 1)
      const opacity = index < fadeIndex ? 1 : 1 - ((index - fadeIndex) / (this.config.maxDepartures - fadeIndex))
      row.style.opacity = Math.max(opacity, 0.25)
    }

    if (this.config.showRoute) {
      const route = document.createElement("td")
      route.className = "nta-route bright"
      route.textContent = departure.route || "–"
      row.appendChild(route)
    }

    const destination = document.createElement("td")
    destination.className = "nta-destination"
    destination.textContent = this.getDestinationText(departure)
    row.appendChild(destination)

    const time = document.createElement("td")
    time.className = "nta-time bright"
    time.textContent = this.formatDepartureTime(departure)
    row.appendChild(time)

    return row
  },

  getDestinationText(departure) {
    const parts = []

    if (this.config.showDestination && departure.destination) {
      parts.push(departure.destination)
    }

    if (this.config.showStopName && departure.stopName) {
      parts.push(departure.stopName)
    }

    return parts.join(" · ") || departure.stopId || "Unknown stop"
  },

  formatDepartureTime(departure) {
    if (departure.cancelled) {
      return "Cancelled"
    }

    if (!departure.realtimeTime) {
      return "–"
    }

    if (this.config.timeFormat === "absolute") {
      return new Date(departure.realtimeTime * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    }

    const diffMinutes = Math.max(Math.round(((departure.realtimeTime * 1000) - Date.now()) / 60000), 0)
    const delay = this.formatDelay(departure.delaySeconds)

    if (diffMinutes === 0) {
      return `Due${delay}`
    }

    return `${diffMinutes} min${delay}`
  },

  formatDelay(delaySeconds) {
    if (!this.config.showDelay || !delaySeconds) {
      return ""
    }

    const delayMinutes = Math.round(delaySeconds / 60)

    if (delayMinutes > 0) {
      return ` +${delayMinutes}`
    }

    if (delayMinutes < 0) {
      return ` ${delayMinutes}`
    }

    return ""
  },

  createMessage(message, className) {
    const element = document.createElement("div")
    element.className = className
    element.textContent = message
    return element
  },

  fetchDepartures() {
    this.log("Requesting departure update")
    this.sendSocketNotification("NTA_FETCH_DEPARTURES")
  },

  log(message) {
    if (this.config.debug) {
      Log.info(`[MMM-NTA-Ireland] ${message}`)
    }
  },

  scheduleNextFetch() {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer)
    }

    this.scheduleTimer = setTimeout(() => this.fetchDepartures(), this.config.refreshInterval)
  },
})
