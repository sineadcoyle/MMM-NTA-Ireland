const fs = require("fs")
const path = require("path")

function loadStaticGtfs(directory) {
  const stops = parseCsvFile(path.join(directory, "stops.txt"))
  const trips = parseCsvFile(path.join(directory, "trips.txt"))
  const stopTimes = parseCsvFile(path.join(directory, "stop_times.txt"))
  const stopCodeToId = new Map(stops
    .filter(stop => stop.stop_code && stop.stop_id)
    .map(stop => [stop.stop_code, stop.stop_id]))
  const tripStartDates = new Map(trips.map(trip => [trip.trip_id, trip.start_date || ""]))
  const scheduledTimes = new Map()

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
  })

  return {
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
  loadStaticGtfs,
  parseCsv,
}
