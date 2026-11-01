// Imported by src/index.ts before the app: Express must be loaded after the instrumentation (MAIR-504).
// Off without OTEL_EXPORTER_OTLP_ENDPOINT, so tests and local runs export nothing.
import { startTelemetry } from '@mairie360/bffs-lib';

startTelemetry({ serviceName: 'bff-project' });
