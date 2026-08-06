export function isCrewChildProcess(): boolean {
  return process.env.PI_CREW_WORKER === "1"
    || !!process.env.PI_LOBBY_ID
    || !!process.env.PI_CREW_ROLE;
}
