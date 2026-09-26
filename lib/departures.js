const { getScheduledDeparture } = require("./static-gtfs")

function extractDepartures(feed, config, currentTime = Date.now(), staticTimes = new Map()) {
  const stopConfigById = getStopConfigById(config.stops || [])
  const stopIds = new Set(Object.keys(stopConfigById))
  const entities = asArray(feed.entity || feed.entities)
  const departures = []
  const nowSeconds = Math.floor(currentTime / 1000)
  const windowSeconds = (config.departureWindowMinutes || 120) * 60

  entities.forEach((entity) => {
    const tripUpdate = entity.tripUpdate || entity.trip_update

    if (!tripUpdate) {
      return
    }

    const trip = tripUpdate.trip || {}
    const stopTimeUpdates = asArray(tripUpdate.stopTimeUpdate || tripUpdate.stop_time_update)

    stopTimeUpdates.forEach((stopTimeUpdate) => {
      const stopId = value(stopTimeUpdate.stopId, stopTimeUpdate.stop_id)

      if (!stopIds.has(stopId)) {
        return
      }

      const departure = getDepartureEvent(
        stopTimeUpdate,
        trip,
        staticTimes,
        currentTime,
      )

      if (!departure || !departure.time) {
        return
      }

      if (departure.time < nowSeconds || departure.time > nowSeconds + windowSeconds) {
        return
      }

      departures.push({
        stopId,
        stopName: stopConfigById[stopId].name || stopId.toString(),
        route: cleanRouteId(value(trip.routeId, trip.route_id)),
        destination: value(stopTimeUpdate.stopHeadsign, stopTimeUpdate.stop_headsign, trip.tripHeadsign, trip.trip_headsign),
        scheduledTime: departure.scheduledTime,
        realtimeTime: departure.time,
        delaySeconds: departure.delaySeconds,
        cancelled: isCancelled(stopTimeUpdate, trip),
      })
    })
  })

  return departures
    .filter(departure => config.showCancelled || !departure.cancelled)
    .sort((first, second) => first.realtimeTime - second.realtimeTime)
    .slice(0, config.maxDepartures)
}

function getStopConfigById(stopsConfig) {
  return stopsConfig.reduce((stops, stop) => {
    if (typeof stop === "string") {
      stops[stop] = { id: stop, name: "" }
      return stops
    }

    const id = value(stop.id, stop.code, stop.stopId, stop.stop_id)

    if (id) {
      stops[id] = { ...stop, id }
    }

    return stops
  }, {})
}

function getDepartureEvent(stopTimeUpdate, trip, staticTimes, currentTime) {
  const realtimeEvent = getStopTimeEvent(stopTimeUpdate.departure) || getStopTimeEvent(stopTimeUpdate.arrival)
  if (realtimeEvent) {
    return realtimeEvent
  }

  const tripId = value(trip.tripId, trip.trip_id)
  const stopId = value(stopTimeUpdate.stopId, stopTimeUpdate.stop_id)
  const scheduledTime = staticTimes && tripId
    ? staticTimes.get(`${tripId}|${stopId}`)
    : null

  if (!scheduledTime) {
    return null
  }

  const staticDeparture = typeof scheduledTime === "number"
    ? scheduledTime
    : getScheduledDeparture(staticTimes, tripId, stopId, new Date(currentTime))
  const delaySeconds = Number(value(
    stopTimeUpdate.departure?.delay,
    stopTimeUpdate.departure?.Delay,
    stopTimeUpdate.arrival?.delay,
    stopTimeUpdate.arrival?.Delay,
    0,
  ))

  if (!Number.isFinite(staticDeparture)) {
    return null
  }

  return {
    time: staticDeparture + (Number.isFinite(delaySeconds) ? delaySeconds : 0),
    scheduledTime: staticDeparture,
    delaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : 0,
  }
}

function getStopTimeEvent(event) {
  if (!event) {
    return null
  }

  const time = Number(value(event.time, event.Time))
  const delaySeconds = Number(value(event.delay, event.Delay, 0))

  if (!Number.isFinite(time)) {
    return null
  }

  return {
    time,
    scheduledTime: Number.isFinite(time - delaySeconds) ? time - delaySeconds : time,
    delaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : 0,
  }
}

function isCancelled(stopTimeUpdate, trip) {
  const relationship = value(
    stopTimeUpdate.scheduleRelationship,
    stopTimeUpdate.schedule_relationship,
    trip.scheduleRelationship,
    trip.schedule_relationship,
  )

  return relationship === "SKIPPED" || relationship === "CANCELED" || relationship === "CANCELLED"
}

function cleanRouteId(routeId) {
  if (!routeId) {
    return ""
  }

  return String(routeId)
    .replace(/^routes:/i, "")
    .replace(/^route:/i, "")
}

function asArray(value) {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function value(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "")
}

module.exports = {
  cleanRouteId,
  extractDepartures,
  getStopConfigById,
  getStopTimeEvent,
  isCancelled,
}
