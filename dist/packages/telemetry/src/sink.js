export class ConsoleTelemetrySink {
    record(event) {
        console.log(`[telemetry] ${event.name}: ${event.details}`);
    }
}
