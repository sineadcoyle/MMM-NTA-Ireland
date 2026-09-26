const assert = require("node:assert/strict")
const test = require("node:test")
const { getScheduledDeparture } = require("../lib/static-gtfs")
const {
  cleanRouteId,
  extractDepartures,
  getStopConfigById,
  getStopTimeEvent,
  isCancelled,
} = require("../lib/departures")

const currentTime = new Date("2026-01-01T12:00:00Z").getTime()
const nowSeconds = Math.floor(currentTime / 1000)

function createConfig(overrides = {}) {
  return {
    stops: [
      { id: "8220B10001", name: "Home stop" },
      "8220B10002",
    ],
    maxDepartures: 5,
    departureWindowMinutes: 60,
    ...overrides,
  }
}

test("extractDepartures filters by configured stops and sorts by realtime time", () => {
  const feed = {
    entity: [
      {
        tripUpdate: {
          trip: { routeId: "routes:46A", tripHeadsign: "Dún Laoghaire" },
          stopTimeUpdate: [
            {
              stopId: "8220B10001",
              departure: { time: nowSeconds + 600, delay: 60 },
            },
          ],
        },
      },
      {
        tripUpdate: {
          trip: { routeId: "route:145", tripHeadsign: "Heuston Station" },
          stopTimeUpdate: [
            {
              stopId: "8220B10002",
              departure: { time: nowSeconds + 180, delay: 0 },
            },
          ],
        },
      },
      {
        tripUpdate: {
          trip: { routeId: "155", tripHeadsign: "Outside configured stops" },
          stopTimeUpdate: [
            {
              stopId: "8220B99999",
              departure: { time: nowSeconds + 120, delay: 0 },
            },
          ],
        },
      },
    ],
  }

  const departures = extractDepartures(feed, createConfig(), currentTime)

  assert.deepEqual(departures.map(departure => departure.route), ["145", "46A"])
  assert.equal(departures[0].stopId, "8220B10002")
  assert.equal(departures[1].stopName, "Home stop")
  assert.equal(departures[1].scheduledTime, nowSeconds + 540)
  assert.equal(departures[1].delaySeconds, 60)
})

test("extractDepartures respects maxDepartures and departureWindowMinutes", () => {
  const feed = {
    entity: [
      createTrip("1", nowSeconds + 60),
      createTrip("2", nowSeconds + 120),
      createTrip("3", nowSeconds + 180),
      createTrip("4", nowSeconds + 7200),
      createTrip("5", nowSeconds - 60),
    ],
  }

  const departures = extractDepartures(feed, createConfig({
    maxDepartures: 2,
    departureWindowMinutes: 10,
  }), currentTime)

  assert.deepEqual(departures.map(departure => departure.route), ["1", "2"])
})

test("extractDepartures excludes skipped and cancelled departures by default", () => {
  const feed = {
    entity: [
      createTrip("1", nowSeconds + 60, { scheduleRelationship: "SKIPPED" }),
      createTrip("2", nowSeconds + 120, { schedule_relationship: "CANCELED" }),
      createTrip("3", nowSeconds + 180),
    ],
  }

  const departures = extractDepartures(feed, createConfig(), currentTime)

  assert.deepEqual(departures.map(departure => departure.route), ["3"])
})

test("extractDepartures includes skipped and cancelled departures when showCancelled is true", () => {
  const feed = {
    entity: [
      createTrip("1", nowSeconds + 60, { scheduleRelationship: "SKIPPED" }),
      createTrip("2", nowSeconds + 120, { schedule_relationship: "CANCELED" }),
      createTrip("3", nowSeconds + 180),
    ],
  }

  const departures = extractDepartures(feed, createConfig({ showCancelled: true }), currentTime)

  assert.deepEqual(departures.map(departure => departure.route), ["1", "2", "3"])
  assert.deepEqual(departures.map(departure => departure.cancelled), [true, true, false])
})

test("extractDepartures supports snake_case GTFS-Realtime JSON fields", () => {
  const feed = {
    entity: [
      {
        trip_update: {
          trip: { route_id: "routes:39A", trip_headsign: "UCD" },
          stop_time_update: [
            {
              stop_id: "8220B10001",
              stop_headsign: "UCD Belfield",
              departure: { time: nowSeconds + 300, delay: 30 },
            },
          ],
        },
      },
    ],
  }

  const departures = extractDepartures(feed, createConfig(), currentTime)

  assert.equal(departures.length, 1)
  assert.equal(departures[0].route, "39A")
  assert.equal(departures[0].destination, "UCD Belfield")
  assert.equal(departures[0].realtimeTime, nowSeconds + 300)
})

test("extractDepartures uses static schedule time plus realtime delay when time is missing", () => {
  const feed = {
    entity: [
      {
        trip_update: {
          trip: { trip_id: "trip-1", route_id: "15" },
          stop_time_update: [
            {
              stop_id: "8220B10001",
              departure: { delay: 120 },
            },
          ],
        },
      },
    ],
  }
  const staticTimes = new Map([
    ["trip-1|8220B10001", { departureTime: "12:05:00", startDate: "20260101" }],
  ])

  const departures = extractDepartures(feed, createConfig(), currentTime, staticTimes)

  const scheduledTime = getScheduledDeparture(staticTimes, "trip-1", "8220B10001", new Date(currentTime))
  assert.equal(departures.length, 1)
  assert.equal(departures[0].scheduledTime, scheduledTime)
  assert.equal(departures[0].realtimeTime, scheduledTime + 120)
  assert.equal(departures[0].delaySeconds, 120)
})

test("extractDepartures falls back to arrival when departure is missing", () => {
  const feed = {
    entity: [
      {
        tripUpdate: {
          trip: { routeId: "15" },
          stopTimeUpdate: [
            {
              stopId: "8220B10001",
              arrival: { time: nowSeconds + 300, delay: 0 },
            },
          ],
        },
      },
    ],
  }

  const departures = extractDepartures(feed, createConfig(), currentTime)

  assert.equal(departures.length, 1)
  assert.equal(departures[0].route, "15")
})

test("getStopConfigById supports strings and stop object aliases", () => {
  assert.deepEqual(getStopConfigById([
    "8220B10001",
    { code: "8220B10002", name: "Work stop" },
    { stopId: "8220B10003", name: "Town stop" },
  ]), {
    "8220B10001": { id: "8220B10001", name: "" },
    "8220B10002": { code: "8220B10002", id: "8220B10002", name: "Work stop" },
    "8220B10003": { id: "8220B10003", name: "Town stop", stopId: "8220B10003" },
  })
})

test("getStopTimeEvent normalises time and delay", () => {
  assert.deepEqual(getStopTimeEvent({ time: "1767270000", delay: "120" }), {
    time: 1767270000,
    scheduledTime: 1767269880,
    delaySeconds: 120,
  })

  assert.equal(getStopTimeEvent({ delay: 120 }), null)
})

test("cleanRouteId removes common GTFS route prefixes", () => {
  assert.equal(cleanRouteId("routes:46A"), "46A")
  assert.equal(cleanRouteId("route:145"), "145")
  assert.equal(cleanRouteId("39A"), "39A")
  assert.equal(cleanRouteId(null), "")
})

test("isCancelled recognises cancellation relationships", () => {
  assert.equal(isCancelled({ scheduleRelationship: "SKIPPED" }, {}), true)
  assert.equal(isCancelled({}, { schedule_relationship: "CANCELLED" }), true)
  assert.equal(isCancelled({}, {}), false)
})

function createTrip(routeId, time, stopTimeUpdateOverrides = {}) {
  return {
    tripUpdate: {
      trip: { routeId },
      stopTimeUpdate: [
        {
          stopId: "8220B10001",
          departure: { time, delay: 0 },
          ...stopTimeUpdateOverrides,
        },
      ],
    },
  }
}
