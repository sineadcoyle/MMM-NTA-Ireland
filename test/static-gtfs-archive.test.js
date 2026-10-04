const assert = require("node:assert/strict")
const test = require("node:test")
const {
  selectStaticGtfsArchiveEntries,
} = require("../lib/static-gtfs-archive")

test("selectStaticGtfsArchiveEntries extracts only required and supported optional files", () => {
  const entries = selectStaticGtfsArchiveEntries([
    "agency.txt",
    "calendar.txt",
    "calendar_dates.txt",
    "routes.txt",
    "shapes.txt",
    "stop_times.txt",
    "stops.txt",
    "trips.txt",
  ])

  assert.deepEqual(entries, [
    "stops.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt",
  ])
})

test("selectStaticGtfsArchiveEntries supports GTFS files nested in directories", () => {
  const entries = selectStaticGtfsArchiveEntries([
    "GTFS_All/agency.txt",
    "GTFS_All/calendar.txt",
    "GTFS_All/stop_times.txt",
    "GTFS_All/stops.txt",
    "GTFS_All/trips.txt",
  ])

  assert.deepEqual(entries, [
    "GTFS_All/stops.txt",
    "GTFS_All/trips.txt",
    "GTFS_All/stop_times.txt",
    "GTFS_All/calendar.txt",
  ])
})

test("selectStaticGtfsArchiveEntries ignores missing optional files", () => {
  const entries = selectStaticGtfsArchiveEntries([
    "stop_times.txt",
    "stops.txt",
    "trips.txt",
  ])

  assert.deepEqual(entries, [
    "stops.txt",
    "trips.txt",
    "stop_times.txt",
  ])
})

test("selectStaticGtfsArchiveEntries throws when a required file is missing", () => {
  assert.throws(
    () => selectStaticGtfsArchiveEntries([
      "stops.txt",
      "trips.txt",
    ]),
    /Static GTFS file not found in archive: stop_times\.txt/,
  )
})
