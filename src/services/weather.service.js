import { env } from "../config/env.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_WINDOW_MS = 6 * 60 * 60 * 1000;
const weatherCache = new Map();

const WMO_CONDITIONS = new Map([
  [0, "Cerah"], [1, "Cerah berawan"], [2, "Berawan sebagian"], [3, "Berawan"],
  [45, "Berkabut"], [48, "Kabut tebal"], [51, "Gerimis ringan"], [53, "Gerimis"], [55, "Gerimis lebat"],
  [56, "Gerimis beku ringan"], [57, "Gerimis beku lebat"], [61, "Hujan ringan"], [63, "Hujan"], [65, "Hujan lebat"],
  [66, "Hujan beku ringan"], [67, "Hujan beku lebat"], [71, "Salju ringan"], [73, "Salju"], [75, "Salju lebat"],
  [77, "Butiran salju"], [80, "Hujan lokal ringan"], [81, "Hujan lokal"], [82, "Hujan lokal lebat"],
  [85, "Hujan salju ringan"], [86, "Hujan salju lebat"], [95, "Badai petir"], [96, "Badai petir dan hujan es"], [99, "Badai petir kuat"]
]);

function iconFor(code) {
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "🌤️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57, 80, 81, 82].includes(code)) return "🌦️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  if ([61, 63, 65, 66, 67].includes(code)) return "🌧️";
  return "🌤️";
}

function recommendationFor({ rainProbabilityPct, maxTemperatureC }) {
  if (Number(rainProbabilityPct) >= 60) return "Periksa drainase dan hindari penyemprotan saat hujan.";
  if (Number(maxTemperatureC) >= 32) return "Periksa kelembapan tanah sebelum menyiram.";
  return "Periksa kondisi tanaman dan kelembapan tanah secara rutin.";
}

function baseResult(status, extra = {}) {
  return {
    status,
    timezone: null,
    current: null,
    forecast: [],
    source: "Open-Meteo",
    updatedAt: null,
    isStale: false,
    ...extra
  };
}

export async function getWeatherSummary(farm) {
  if (!farm || farm.latitude == null || farm.longitude == null) {
    return baseResult("LOCATION_REQUIRED", {
      detail: "Lengkapi koordinat kebun untuk menampilkan prakiraan cuaca lokal."
    });
  }

  const cacheKey = `${Number(farm.latitude).toFixed(4)},${Number(farm.longitude).toFixed(4)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(farm.latitude),
    longitude: String(farm.longitude),
    current: "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code",
    daily: "weather_code,temperature_2m_max,precipitation_probability_max",
    forecast_days: "7",
    timezone: "auto",
    wind_speed_unit: "ms"
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.WEATHER_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) {
      return cached && cached.cachedAt + STALE_WINDOW_MS > Date.now()
        ? { ...cached.data, status: "STALE", isStale: true, detail: `Gagal menyegarkan cuaca (HTTP ${response.status}); memakai cache terakhir.` }
        : baseResult("UNAVAILABLE", { detail: `Penyedia cuaca mengembalikan HTTP ${response.status}.` });
    }
    const payload = await response.json();
    const current = payload.current;
    const daily = payload.daily;
    if (!current || !daily?.time?.length) return baseResult("UNAVAILABLE", { detail: "Format data cuaca belum lengkap." });

    const forecast = daily.time.map((date, index) => {
      const maxTemperatureC = daily.temperature_2m_max?.[index] ?? null;
      const rainProbabilityPct = daily.precipitation_probability_max?.[index] ?? null;
      const weatherCode = daily.weather_code?.[index] ?? null;
      return {
        date,
        maxTemperatureC,
        rainProbabilityPct,
        weatherCode,
        condition: WMO_CONDITIONS.get(weatherCode) || "Kondisi tidak diketahui",
        icon: iconFor(weatherCode),
        temp: maxTemperatureC == null ? null : `${Math.round(maxTemperatureC)}°`,
        rain: rainProbabilityPct,
        recommendation: recommendationFor({ rainProbabilityPct, maxTemperatureC })
      };
    });

    const todayForecast = forecast[0];
    // Open-Meteo returns current.time in the requested location's timezone.
    const updatedAt = current.time || new Date().toISOString();
    const result = {
      status: "AVAILABLE",
      timezone: payload.timezone || null,
      current: {
        temperatureC: current.temperature_2m ?? null,
        temp: current.temperature_2m == null ? null : `${Math.round(current.temperature_2m)}°`,
        condition: WMO_CONDITIONS.get(current.weather_code) || "Kondisi tidak diketahui",
        icon: iconFor(current.weather_code),
        humidityPct: current.relative_humidity_2m ?? null,
        humidityDisplay: current.relative_humidity_2m == null ? null : `${Math.round(current.relative_humidity_2m)}%`,
        windSpeedMs: current.wind_speed_10m ?? null,
        windDisplay: current.wind_speed_10m == null ? null : `${Number(current.wind_speed_10m).toLocaleString("id-ID", { maximumFractionDigits: 1 })} m/s`,
        precipitationMm: current.precipitation ?? null,
        rainProbabilityPct: todayForecast?.rainProbabilityPct ?? null,
        rainDisplay: todayForecast?.rainProbabilityPct == null ? null : `${todayForecast.rainProbabilityPct}%`,
        observedAt: updatedAt
      },
      forecast,
      source: "Open-Meteo",
      updatedAt,
      isStale: false
    };
    weatherCache.set(cacheKey, { data: result, cachedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (error) {
    const timeoutError = error?.name === "AbortError";
    if (cached && cached.cachedAt + STALE_WINDOW_MS > Date.now()) {
      return { ...cached.data, status: "STALE", isStale: true, detail: timeoutError ? "Waktu permintaan habis; memakai cache cuaca terakhir." : "Layanan cuaca tidak dapat diakses; memakai cache terakhir." };
    }
    return baseResult("UNAVAILABLE", {
      detail: timeoutError ? "Permintaan cuaca melewati batas waktu." : "Layanan cuaca sementara tidak dapat diakses."
    });
  } finally {
    clearTimeout(timeout);
  }
}
