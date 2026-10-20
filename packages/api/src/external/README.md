# External integrations

Each file in this folder is a typed wrapper around an Edge Function:

- `tomtom.ts` — POIs, traffic incidents (replaces CamerasController.GetEmergencyPOIs, GetTrafficIncidents)
- `openweather.ts` — current weather
- `weather-archive.ts` — historical weather (ReportsController.FetchHistoricalWeatherAsync, free Open-Meteo)
- `flightradar.ts` — live flights + tracks
- `marinesia.ts` — marine AIS positions
- `bulksms.ts` — send SMS (NotificationsController.TriggerLocationSms)
- `gemini.ts` — Criti chatbot wrapper with action-code parsing
- `sendgrid.ts` — transactional email

All of these call Edge Functions named `<service>-proxy` so the API keys never reach the client bundle. Implementations land in Phase 4. The folder exists now so the import paths are stable.
