import { Bot } from "mineflayer";
import { Item } from "prismarine-item";
import { Vec3 } from "vec3";
import Build from "./lib/Build";

export interface BuildOptions {
  /**@description Default: 3 - Range the bot can place blocks at */
  range ? : number
  /**@description Default: `true` - If the bot should use line of sight when placing blocks */
  LOS ? : boolean
  /**@description Default: 0 - The point at witch build cancels for lack of materials */
  materialMin?: number
  placeSort: (a: Action, b: Action) => number
}

export interface Action {
  type: 'place' | 'dig'
  pos: Vec3
  state: number
  dependsOn?: Vec3
}

export interface BuildReturnObject {
  status: 'finished' | 'cancel',
  data: object 
    | {
      error: 'missing_material',
      item: Item
    }
}

declare module 'mineflayer-builder' {
  export function builder(bot: Bot): void;

  export interface Builder {
    currentBuild?: Build
    equipItem: (id: number) => Promise<void>;
    stop: () => void;
    pause: () => void;
    continue: () => void;
    build: (build: Build, buildOptions: BuildOptions) => Promise<void>;
  }

}

declare module 'mineflayer' {
	interface Bot {
		builder: Builder
	}
}