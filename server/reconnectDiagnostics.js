// Explicit, opt-in diagnostics. Never accept raw URLs, tokens, names or bodies.
export function createReconnectDiagnostics({ enabled = process.env.TOWN_DEBUG_RECONNECT === '1', write = console.info } = {}) {
  const suffix = value => typeof value === 'string' ? value.replace(/[^A-Za-z0-9_-]/g, '').slice(-6) : undefined;
  return (event, details = {}) => {
    if (!enabled) return;
    const safe = { timestamp: new Date().toISOString(), event: String(event).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 48) };
    if (details.roomId) safe.room = suffix(details.roomId);
    if (details.sessionId) safe.session = suffix(details.sessionId);
    for (const field of ['closeCode', 'status', 'connectedClients', 'players', 'reconnectSeconds', 'durationMs']) {
      if (Number.isFinite(details[field])) safe[field] = details[field];
    }
    for (const field of ['roomExists', 'hasPlayer', 'hasReservedSeat', 'registered']) {
      if (typeof details[field] === 'boolean') safe[field] = details[field];
    }
    write(`[town-reconnect] ${JSON.stringify(safe)}`);
  };
}
