const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const {
  getScheduledDeparture,
  getScheduleKey,
  loadStaticGtfs,
  parseCsv,
} = require("../lib/static-gtfs")

test("parseCsv supports headers, quoted commas, and escaped quotes", () => {
  const records = parseCsv("stop_id,stop_name,description\n1,\"Derry Bus Station\",\"Platform, north\"\n2,\"Town \"\"Centre\"\"\",\"Main stop\"")

  assert.deepEqual(records, [
    { stop_id: "1", stop_name: "Derry Bus Station", description: "Platform, north" },
    { stop_id: "2", stop_name: "Town \"Centre\"", description: "Main stop" },
  ])
})

test("loadStaticGtfs maps stop codes and indexes trip stop times", () => {
  const directory = createGtfsFixture()

  try {
    const gtfs = loadStaticGtfs(directory)

    assert.equal(gtfs.stopCodeToId.get("158131"), "7010B158131")
    assert.deepEqual(gtfs.scheduledTimes.get(getScheduleKey("trip-1", "7010B158131")), {
      departureTime: "12:05:00",
      startDate: "",
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test("getScheduledDeparture converts a static GTFS time to an epoch timestamp", () => {
  const scheduledTimes = new Map([
    ["trip-1|7010B158131", { departureTime: "12:05:00", startDate: "20260101" }],
  ])

  const departure = getScheduledDeparture(
    scheduledTimes,
    "trip-1",
    "7010B158131",
    new Date("2026-01-01T12:00:00"),
  )

  assert.equal(departure, new Date("2026-01-01T12:05:00").getTime() / 1000)
})

test("getScheduledDeparture supports GTFS times after midnight", () => {
  const scheduledTimes = new Map([
    ["trip-1|7010B158131", { departureTime: "24:15:00", startDate: "20260101" }],
  ])

  const departure = getScheduledDeparture(
    scheduledTimes,
    "trip-1",
    "7010B158131",
    new Date("2026-01-01T23:00:00"),
  )

  assert.equal(departure, new Date("2026-01-02T00:15:00").getTime() / 1000)
})

test("getScheduledDeparture returns null for an unknown trip and stop", () => {
  assert.equal(
    getScheduledDeparture(new Map(), "unknown-trip", "unknown-stop", new Date()),
    null,
  )
})

function createGtfsFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-nta-gtfs-test-"))

  fs.writeFileSync(path.join(directory, "stops.txt"), [
    "stop_id,stop_code,stop_name",
    "7010B158131,158131,Derry Bus Station",
  ].join("\n"))
  fs.writeFileSync(path.join(directory, "trips.txt"), [
    "route_id,service_id,trip_id",
    "46A,weekday,trip-1",
  ].join("\n"))
  fs.writeFileSync(path.join(directory, "stop_times.txt"), [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
    "trip-1,12:05:00,12:05:00,7010B158131,1",
  ].join("\n"))

  return directory
}
