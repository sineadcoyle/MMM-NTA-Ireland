# MMM-NTA-Ireland

`MMM-NTA-Ireland` is a [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module that will display upcoming public tr departures using the National Transport Authority GTFS-Realtime API.

This first version focuses on bus stop departures and uses the JSON endpoint:

```text
https://api.nationaltransport.ie/gtfsr/v2/gtfsr?format=json
```

## Screenshot

Screenshot coming soon.

## Requirements

- MagicMirror²
- Node.js supported by your MagicMirror² installation
- National Transport Authority API key

The module sends your API key from the MagicMirror config to the local `node_helper.js`, which then calls the NTA API with the `x-api-key` header. Do not commit your real API key to a public repository.

## Installation

In your MagicMirror `modules` directory:

```bash
cd ~/MagicMirror/modules
git clone https://github.com/sineadcoyle/MMM-NTA-Ireland.git
cd MMM-NTA-Ireland
npm install
```

## Configuration

Add the module to the `modules` array in `config/config.js`:

```js
{
  module: "MMM-NTA-Ireland",
  position: "top_left",
  config: {
    apiKey: "YOUR_NTA_API_KEY",
    stops: [
      { id: "YOUR_STOP_CODE", name: "Home stop" }
    ],
    maxDepartures: 5,
    refreshInterval: 60 * 1000
  }
}
```

You may also configure stops as strings if you do not want to show friendly names:

```js
stops: ["YOUR_STOP_CODE"]
```

### Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | `string` | `""` | Your NTA API key. Required. |
| `apiUrl` | `string` | `"https://api.nationaltransport.ie/gtfsr/v2/gtfsr"` | NTA GTFS-Realtime API endpoint. |
| `stops` | `array` | `[]` | Bus stop codes to show. Use strings or objects like `{ id: "STOP_CODE", name: "Home" }`. Required. |
| `maxDepartures` | `number` | `5` | Maximum number of departures to display. |
| `refreshInterval` | `number` | `60000` | How often to refresh the feed, in milliseconds. |
| `departureWindowMinutes` | `number` | `120` | Only show departures within this many minutes. |
| `animationSpeed` | `number` | `1000` | MagicMirror DOM update animation speed. |
| `moduleHeader` | `string` | `"Bus departures"` | Header displayed above the departure list. Set to `""` to hide. |
| `timeFormat` | `string` | `"relative"` | Use `"relative"` for `3 min`/`Due`, or `"absolute"` for clock times. |
| `showStopName` | `boolean` | `true` | Show the configured stop name beside the destination. |
| `showRoute` | `boolean` | `true` | Show the route ID column. |
| `showDestination` | `boolean` | `true` | Show destination/headsign when present in the feed. |
| `showDelay` | `boolean` | `true` | Append delay in minutes when the feed provides delay data. |
| `fade` | `boolean` | `true` | Fade lower rows. |
| `fadePoint` | `number` | `0.25` | Where the fade effect starts, as a fraction of `maxDepartures`. |
| `loadingMessage` | `string` | `"Loading departures…"` | Message shown before the first response. |
| `noDeparturesMessage` | `string` | `"No upcoming bus departures"` | Message shown when no matching departures are found. |
| `errorMessage` | `string` | `"Unable to load bus departures"` | Generic fallback error message. |

## Notes on stop codes and bus-only data

The module filters the GTFS-Realtime feed by the configured stop codes. For the first version, it is intended for bus stop departures: configure bus stop codes and the display will show matching trip updates from the NTA feed.

GTFS-Realtime trip update records do not always include a human-friendly destination or route short name. When the feed does not provide those fields, the module falls back to the route ID and configured stop name.

## Developer commands

```bash
npm install
node --run lint
node --run lint:fix
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.
