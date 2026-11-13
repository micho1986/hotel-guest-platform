/**
 * Bulk room entry, one line per room or range:
 *   101                → room 101
 *   101, 1             → room 101 on floor 1
 *   101, 1, Tower A    → … in building "Tower A"
 *   101-110, 1         → rooms 101 to 110 on floor 1
 * Blank lines are ignored. Pure function, no database.
 */
export type RoomLine = { number: string; floor: string | null; building: string | null };

export const MAX_ROOMS_PER_IMPORT = 2000;
const ROOM_NUMBER = /^[A-Za-z0-9][A-Za-z0-9-]{0,9}$/;

export function parseRoomLines(text: string): { rooms: RoomLine[]; errors: string[] } {
  const rooms: RoomLine[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const [numberPart, floorPart, ...buildingParts] = line.split(",").map((p) => p.trim());
    const floor = floorPart || null;
    const building = buildingParts.join(",").trim() || null;
    if ((floor && floor.length > 10) || (building && building.length > 40)) {
      errors.push(`Line ${i + 1}: floor or building name is too long`);
      return;
    }

    let numbers: string[];
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(numberPart);
    if (range) {
      const [, startText, endText] = range;
      const start = Number(startText);
      const end = Number(endText);
      if (end < start || end - start >= 500) {
        errors.push(`Line ${i + 1}: range "${numberPart}" must go up and cover at most 500 rooms`);
        return;
      }
      const width = startText.length;
      numbers = Array.from({ length: end - start + 1 }, (_, k) => String(start + k).padStart(width, "0"));
    } else if (ROOM_NUMBER.test(numberPart)) {
      numbers = [numberPart];
    } else {
      errors.push(`Line ${i + 1}: "${numberPart}" is not a valid room number`);
      return;
    }

    for (const number of numbers) {
      if (seen.has(number)) {
        errors.push(`Room ${number} is listed twice`);
        continue;
      }
      seen.add(number);
      rooms.push({ number, floor, building });
    }
  });

  if (rooms.length > MAX_ROOMS_PER_IMPORT) errors.push(`At most ${MAX_ROOMS_PER_IMPORT} rooms per import`);
  return { rooms, errors };
}
