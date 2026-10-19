/**
 * Run one asynchronous submission at a time. The ref is locked synchronously
 * before the operation starts, so rapid clicks cannot race React state updates.
 */
export function runSingleFlight(inFlightRef, operation) {
    if (inFlightRef.current) return Promise.resolve(false);

    inFlightRef.current = true;
    let result;
    try {
        result = operation();
    } catch (error) {
        inFlightRef.current = false;
        return Promise.reject(error);
    }

    return Promise.resolve(result)
        .then(() => true)
        .finally(() => {
            inFlightRef.current = false;
        });
}
