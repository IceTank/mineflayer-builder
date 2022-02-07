import { Bot } from "mineflayer";
import { Item } from "prismarine-item";
import { Vec3 } from "vec3";
import { Block } from 'prismarine-block'
import { Schematic } from "prismarine-schematic";

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
  state?: number
  dependsOn?: Vec3
}

export interface BuildReturnObject {
  status: 'finished' | 'cancel',
  data: null 
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
    build: (build: Build, buildOptions: BuildOptions) => Promise<BuildReturnObject>;
  }

  export type Generator = (pos: Vec3) => Block | null

  export class Build {
    schematic: Schematic
    world: World
    at: Vec3
    min?: Vec3
    max?: Vec3
    isDynamic: boolean
    actions: Action[]
    breakTargetShouldBeAir = true
    breakTargetShouldBeDifferent = true
    placeTargetIsAir = true
    /**@todo Not implemented */
    placeTargetIsReplaceable = true

    blockMatchStrictness: 'same_name' | 'same_state'

    generator: Generator

    updateActions: () => void;
    /** @todo Not implemented */
    updateBlock: (block: Block) => void;
    getItemForState: (stateId: number) => Item;
    getFacing: (stateId: number, facing: number) => { facing: number | null, faceDirection: boolean, is3D: boolean }
    getPossibleDirections: (stateId: number, pos: Vec3) => [Vec3];
    removeAction: (action: Action) => void;
    getAvailableActions: () => Action[];

    constructor(input: Schematic | Generator, world: any, at: Vec3, version: string)
  }
}

declare module 'mineflayer' {
	interface Bot extends Bot {
		builder: Builder
	}
}