const fs = require("fs")
const path = require("path")

function loadStaticGtfs(directory) {
  const stops = parseCsvFile(path.join(directory, "stops.txt"))
  const trips = parseCsvFile(path.join(directory, "trips.txt"))
  const stopTimes = parseCsvFile(path.join(directory, "stop_times.txt"))
  const calendar = parseOptionalCsvFile(path.join(directory, "calendar.txt"))
  const calendarDates = parseOptionalCsvFile(path.join(directory, "calendar_dates.txt"))
  const stopCodeToId = new Map(stops
    .filter(stop => stop.stop_code && stop.stop_id)
    .map(stop => [stop.stop_code, stop.stop_id]))
  const tripById = new Map(trips.map(trip => [trip.trip_id, trip]))
  const tripStartDates = new Map(trips.map(trip => [trip.trip_id, trip.start_date || ""]))
  const scheduledTimes = new Map()
  const scheduledDeparturesByStop = new Map()

  stopTimes.forEach((stopTime) => {
    if (!stopTime.trip_id || !stopTime.stop_id) {
      return
    }

    const departureTime = stopTime.departure_time || stopTime.arrival_time
    if (!departureTime) {
      return
    }

    scheduledTimes.set(
      getScheduleKey(stopTime.trip_id, stopTime.stop_id),
      {
        departureTime,
        startDate: tripStartDates.get(stopTime.trip_id) || "",
      },
    )

    const trip = tripById.get(stopTime.trip_id) || {}
    const stopDepartures = scheduledDeparturesByStop.get(stopTime.stop_id) || []
    stopDepartures.push({
      tripId: stopTime.trip_id,
      stopId: stopTime.stop_id,
      departureTime,
      serviceId: trip.service_id,
      route: trip.route_id || "",
      destination: stopTime.stop_headsign || trip.trip_headsign || "",
    })
    scheduledDeparturesByStop.set(stopTime.stop_id, stopDepartures)
  })

  return {
    calendar,
    calendarDates,
    scheduledDeparturesByStop,
    scheduledTimes,
    stopCodeToId,
  }
}

function parseCsvFile(filePath) {
  const resolvedPath = findFile(filePath)
  if (!resolvedPath) {
    throw new Error(`Static GTFS file not found: ${path.basename(filePath)}`)
  }

  return parseCsv(fs.readFileSync(resolvedPath, "utf8"))
}

function parseOptionalCsvFile(filePath) {
  const resolvedPath = findFile(filePath)
  return resolvedPath ? parseCsv(fs.readFileSync(resolvedPath, "utf8")) : []
}

function findFile(filePath) {
  if (fs.existsSync(filePath)) {
    return filePath
  }

  const directory = path.dirname(filePath)
  if (!fs.existsSync(directory)) {
    return null
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nestedPath = findFile(path.join(entryPath, path.basename(filePath)))
      if (nestedPath) {
        return nestedPath
      }
    }
  }

  return null
}

function parseCsv(contents) {
  const rows = []
  let row = []
  let field = ""
  let quoted = false

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    const nextCharacter = contents[index + 1]

    if (character === "\"" && quoted && nextCharacter === "\"") {
      field += "\""
      index += 1
    } else if (character === "\"") {
      quoted = !quoted
    } else if (character === "," && !quoted) {
      row.push(field)
      field = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1
      }
      row.push(field)
      if (row.some(value => value !== "")) {
        rows.push(row)
      }
      row = []
      field = ""
    } else {
      field += character
    }
  }

  if (field || row.length > 0) {
    row.push(field)
    if (row.some(value => value !== "")) {
      rows.push(row)
    }
  }

  const headers = rows.shift() || []
  return rows.map(values => headers.reduce((record, header, index) => {
    record[header] = values[index] || ""
    return record
  }, {}))
}

function getScheduleKey(tripId, stopId) {
  return `${tripId}|${stopId}`
}

function getStaticDepartures(staticGtfs, stopIds, currentTime = Date.now(), windowMinutes = 120) {
  const date = new Date(currentTime)
  const dateText = formatDate(date)
  const activeServiceIds = getActiveServiceIds(staticGtfs, date)
  const hasCalendar = staticGtfs.calendar.length > 0
  const departures = []
  const windowSeconds = windowMinutes * 60
  const nowSeconds = Math.floor(currentTime / 1000)

  stopIds.forEach((stopId) => {
    const scheduledDepartures = staticGtfs.scheduledDeparturesByStop.get(stopId) || []
    scheduledDepartures.forEach((scheduled) => {
      if (hasCalendar && !activeServiceIds.has(scheduled.serviceId)) {
        return
      }

      const time = getTimestamp(scheduled.departureTime, dateText)
      if (time === null || time < nowSeconds || time > nowSeconds + windowSeconds) {
        return
      }

      departures.push({
        cancelled: false,
        destination: scheduled.destination,
        status: "scheduled",
        delaySeconds: 0,
        realtimeTime: time,
        route: scheduled.route,
        scheduledTime: time,
        stopId: scheduled.stopId,
        tripId: scheduled.tripId,
      })
    })
  })

  return departures
}

function getActiveServiceIds(staticGtfs, date) {
  const dateText = formatDate(date)
  const exceptions = new Map()
  staticGtfs.calendarDates.forEach((calendarDate) => {
    if (calendarDate.date === dateText) {
      exceptions.set(calendarDate.service_id, calendarDate.exception_type)
    }
  })

  const activeServiceIds = new Set()
  staticGtfs.calendar.forEach((service) => {
    const inDateRange = dateText >= service.start_date && dateText <= service.end_date
    const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()]
    const runsToday = service[weekday] === "1"
    if (inDateRange && runsToday) {
      activeServiceIds.add(service.service_id)
    }
  })

  exceptions.forEach((exceptionType, serviceId) => {
    if (exceptionType === "1") {
      activeServiceIds.add(serviceId)
    } else if (exceptionType === "2") {
      activeServiceIds.delete(serviceId)
    }
  })

  return activeServiceIds
}

function getScheduledDeparture(scheduledTimes, tripId, stopId, date = new Date()) {
  const schedule = scheduledTimes.get(getScheduleKey(tripId, stopId))
  if (!schedule) {
    return null
  }

  const dateText = schedule.startDate || formatDate(date)
  const timeParts = schedule.departureTime.split(":").map(Number)
  if (timeParts.length !== 3 || timeParts.some(part => !Number.isFinite(part))) {
    return null
  }

  return getTimestamp(schedule.departureTime, dateText)
}

function getTimestamp(timeText, dateText) {
  const timeParts = timeText.split(":").map(Number)
  if (timeParts.length !== 3 || timeParts.some(part => !Number.isFinite(part))) {
    return null
  }

  const [hours, minutes, seconds] = timeParts
  const departure = new Date(`${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}T00:00:00`)
  departure.setHours(hours, minutes, seconds, 0)

  return Number.isNaN(departure.getTime()) ? null : Math.floor(departure.getTime() / 1000)
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}${month}${day}`
}

module.exports = {
  getScheduledDeparture,
  getScheduleKey,
  getStaticDepartures,
  loadStaticGtfs,
  parseCsv,
}
