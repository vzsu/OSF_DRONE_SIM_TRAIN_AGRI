// Field battery logistics, like a real agri crew: 3 smart packs (one in the drone, two spare),
// one charger slot. Packs get hot in flight and must cool below 45 °C before they will charge.
// The drone's pack state of charge comes from the physics (BATT_SOC) while installed.

export type PackPlace = 'drone' | 'charger' | 'ground';
export interface Pack { id: string; soc: number; tempC: number; cycles: number; place: PackPlace }

export const CHARGE_MAX_TEMP = 45;

export class BatteryBay {
  packs: Pack[] = [];
  /** minutes for 0→100 % on the charger (real chargers ≈ 30–60 min; training default is faster) */
  chargeMinutes = 6;
  ambient = 30;

  reset(startSoc: number, ambient: number, chargeMinutes: number) {
    this.ambient = ambient; this.chargeMinutes = chargeMinutes;
    this.packs = [
      { id: 'A', soc: startSoc, tempC: ambient, cycles: 41, place: 'drone' },
      { id: 'B', soc: 0.35, tempC: ambient, cycles: 38, place: 'charger' },
      { id: 'C', soc: 1.0, tempC: ambient, cycles: 44, place: 'ground' },
    ];
  }

  get inDrone(): Pack | undefined { return this.packs.find((p) => p.place === 'drone'); }
  get onCharger(): Pack | undefined { return this.packs.find((p) => p.place === 'charger'); }

  /** Advance charging + cooling. `droneSoc`/`droneAmps` from the physics while a pack is installed. */
  tick(dt: number, droneSoc: number, droneAmps: number) {
    for (const p of this.packs) {
      if (p.place === 'drone') {
        p.soc = droneSoc;
        // I²R heating vs cooling to ambient (time constant ~10 min)
        p.tempC += (droneAmps * droneAmps * 0.00045 - (p.tempC - this.ambient) / 600) * dt;
      } else {
        p.tempC += (this.ambient - p.tempC) * dt / 300; // cools in the shade, ~5 min time constant
        if (p.place === 'charger' && p.tempC <= CHARGE_MAX_TEMP && p.soc < 1) {
          // CC/CV: constant rate to 80 %, then tapering
          const rate = 1 / (this.chargeMinutes * 60) * (p.soc < 0.8 ? 1.15 : 0.5);
          p.soc = Math.min(1, p.soc + rate * dt);
          p.tempC += 0.004 * dt;
          if (p.soc >= 1) p.cycles++;
        }
      }
    }
  }

  status(p: Pack): string {
    if (p.place === 'drone') return 'In drone';
    if (p.place === 'charger') return p.soc >= 1 ? 'Charged' : p.tempC > CHARGE_MAX_TEMP ? `Too hot — cooling (${p.tempC.toFixed(0)} °C)` : 'Charging';
    return p.soc >= 0.95 ? 'Ready' : 'Needs charge';
  }

  /** Move a pack. Returns an error text or '' when done. Caller checks the drone is landed + disarmed. */
  move(id: string, to: PackPlace): string {
    const p = this.packs.find((x) => x.id === id);
    if (!p) return 'No such pack';
    if (to === 'drone' && this.inDrone) return 'Remove the pack in the drone first';
    if (to === 'charger' && this.onCharger) return 'Charger slot is busy — take the other pack off first';
    p.place = to;
    return '';
  }
}
