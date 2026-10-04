const path = require("path")

const REQUIRED_STATIC_GTFS_FILES = ["stops.txt", "trips.txt", "stop_times.txt"]
const OPTIONAL_STATIC_GTFS_FILES = ["calendar.txt", "calendar_dates.txt"]

function selectStaticGtfsArchiveEntries(archiveEntries) {
  const entriesToExtract = []

  for (const fileName of REQUIRED_STATIC_GTFS_FILES) {
    const archiveEntry = archiveEntries.find(entry => path.basename(entry) === fileName)
    if (!archiveEntry) {
      throw new Error(`Static GTFS file not found in archive: ${fileName}`)
    }
    entriesToExtract.push(archiveEntry)
  }

  OPTIONAL_STATIC_GTFS_FILES.forEach((fileName) => {
    const archiveEntry = archiveEntries.find(entry => path.basename(entry) === fileName)
    if (archiveEntry) {
      entriesToExtract.push(archiveEntry)
    }
  })

  return entriesToExtract
}

module.exports = {
  OPTIONAL_STATIC_GTFS_FILES,
  REQUIRED_STATIC_GTFS_FILES,
  selectStaticGtfsArchiveEntries,
}
