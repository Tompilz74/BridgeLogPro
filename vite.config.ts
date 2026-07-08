import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createVesselPositionApiHandler } from './server/br1GpsProvider'
import { createNmeaApiHandler } from './server/nmeaApi'

function vesselPositionApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'vessel-position-api',
    configureServer(server) {
      server.middlewares.use(
        '/api/vessel-position',
        createVesselPositionApiHandler({
          baseUrl: env.BR1_BASE_URL || 'http://192.168.50.1',
          username: env.BR1_USERNAME,
          password: env.BR1_PASSWORD,
          gpsPath: env.BR1_GPS_PATH,
        })
      )
    },
  }
}

function nmeaApiPlugin(env: Record<string, string>): Plugin {
  const listenPort = Number(env.NMEA_LISTEN_PORT || 10110)

  return {
    name: 'nmea-api',
    configureServer(server) {
      server.middlewares.use(
        '/api/nmea',
        createNmeaApiHandler({
          listenHost: env.NMEA_LISTEN_HOST || '0.0.0.0',
          listenPort: Number.isFinite(listenPort) ? listenPort : 10110,
          simulatorEnabled: env.NMEA_SIMULATOR === 'true',
        })
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), vesselPositionApiPlugin(env), nmeaApiPlugin(env)],
  }
})
