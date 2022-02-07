const { Vec3 } = require('vec3')
const facingData = require('./facingData.json')
const { iterators } = require('prismarine-world')

const { getShapeFaceCenters } = require('mineflayer-pathfinder/lib/shapes')

class Build {
  /**
   *
   * @param {import('prismarine-schematic').Schematic | (pos: import('vec3').Vec3) => import('prismarine-block').Block | null} schematic schematic
   * @param {import('prismarine-world').World} world
   * @param {Vec3} at
   */
  constructor (schematic, world, at, version) {
    this.version = version
    this.schematic = schematic
    /** @type {(pos: import('vec3').Vec3) => import('prismarine-block').Block?} */
    this.generator = undefined
    if (typeof schematic === 'function') {
      this.generator = schematic
      this.isDynamic = true
    } else {
      this.generator = (pos) => {
        return schematic.getBlock(pos)
      }
      this.min = at.plus(schematic.offset)
      this.max = this.min.plus(schematic.size)
      this.isDynamic = false
    }
    this.world = world
    this.at = at.floored()

    this.breakTargetShouldBeAir = true
    this.breakTargetShouldBeDifferent = true
    this.placeTargetIsAir = true
    this.placeTargetIsReplaceable = true

    this.blockMatchStrictness = 'same_name'

    this.blocks = {}
    this.properties = {}
    this.items = {}
    if (!this.isDynamic) {
      this.updateCache(schematic.palette)
    }

    this.actions = []
    this.updateActions()
    // How many actions ?
    // console.log(this.actions)
  }
  /**
   * Should be  | Is Air     | Is not Air | Different solid Block
   * -----------|------------|------------|----------------------
   * Air        | Do nothing | Dig        | Dig
   *            |            |            |
   * Not Air    | Place      | Do noting  | Dig + Place
   */

  updateCache (stateIds) {
    // Cache of blockstate to block
    const Block = require('prismarine-block')(this.version)
    const mcData = require('minecraft-data')(this.version)
    for (const stateId of stateIds) {
      if (stateId in this.blocks) continue
      const block = Block.fromStateId(stateId, 0)
      this.blocks[stateId] = block
      this.properties[stateId] = block.getProperties()
      this.items[stateId] = mcData.itemsByName[block.name]
      if (!this.items[stateId]) console.warn('Minecraft data item miss for block ' + block.name)
    }
  }

  updateActionsForDynamic (pos = null) {
    const maxActions = 50
    let actionsAdded = 0
    const maxSearchDistance = 50
    this.actions = []

    let stateInWorld
    let blockInWorld
    let wantedState
    let wantedBlock

    const visited = new Set()

    const start = pos ? pos.floored() : this.at
    const it = new iterators.OctahedronIterator(start, maxSearchDistance)
    /** @type {import('vec3').Vec3} */
    let cursor = new Vec3(0, 0, 0)
    while ((cursor = it.next()) && actionsAdded < maxActions) {
      debugger
      if (visited.has(cursor.toString())) continue
      visited.add(cursor.toString())
      blockInWorld = this.world.getBlock(cursor)
      if (!blockInWorld.diggable) continue
      if (this.blockMatchStrictness === 'same_name') {
        wantedBlock = this.generator(cursor.minus(this.at))
      }
      stateInWorld = this.world.getBlockStateId(cursor)
      const b = this.generator(cursor.minus(this.at))
      if (!b) continue
      wantedState = b.stateId !== undefined ? b.stateId : (b.id << 4) + (b.metadata || 0)

      this.updateCache([wantedState, stateInWorld])
      // wantedState = this.schematic.getBlockStateId(cursor.minus(this.at))
      // Want state is air/empty
      if (wantedState === 0) { // Or other types off air
        if (stateInWorld === 0) { // Or other types off air
          continue
        }
        if (stateInWorld !== 0 && this.breakTargetShouldBeAir) { // Or other types off air
          this.actions.push({ type: 'dig', pos: cursor.clone() })
          actionsAdded++
          continue
        }
        // Wanted state is not type air
      } else if (wantedState !== 0) {
        if (stateInWorld === 0 && this.placeTargetIsAir) { // Or other types off air
          this.actions.push({ type: 'place', pos: cursor.clone(), state: wantedState })
          actionsAdded++
          continue
        }
        if (((this.blockMatchStrictness === 'same_state' && stateInWorld !== wantedState) || (wantedBlock?.name !== blockInWorld?.name)) &&
          this.breakTargetShouldBeDifferent) {
          this.actions.push({ type: 'dig', pos: cursor.clone() })
          this.actions.push({ type: 'place', pos: cursor.clone(), dependsOn: cursor.clone(), state: wantedState })
          actionsAdded++
          continue
        }
        /**
        if (stateInWorld !== wantedState && this.placeTargetIsReplaceable TODO && isReplacable(stateInWorld)) {

        } */
      }
    }
  }

  updateActions (pos = null) {
    if (this.isDynamic) {
      this.updateActionsForDynamic(pos)
    } else {
      this.updateActionsForStatic()
    }
  }

  updateActionsForStatic () {
    this.actions = []
    const cursor = new Vec3(0, 0, 0)
    for (cursor.y = this.min.y; cursor.y < this.max.y; cursor.y++) {
      for (cursor.z = this.min.z; cursor.z < this.max.z; cursor.z++) {
        for (cursor.x = this.min.x; cursor.x < this.max.x; cursor.x++) {
          let stateInWorld
          let blockInWorld
          let wantedState
          let wantedBlock
          if (this.blockMatchStrictness === 'same_name') {
            blockInWorld = this.world.getBlock(cursor)
            wantedBlock = this.schematic.getBlock(cursor.minus(this.at))
          }
          stateInWorld = this.world.getBlockStateId(cursor)
          wantedState = this.schematic.getBlockStateId(cursor.minus(this.at))
          // Want state is air/empty
          if (wantedState === 0) { // Or other types off air
            if (stateInWorld === 0) { // Or other types off air
              continue
            }
            if (stateInWorld !== 0 && this.breakTargetShouldBeAir) { // Or other types off air
              this.actions.push({ type: 'dig', pos: cursor.clone() })
              continue
            }
            // Wanted state is not type air
          } else if (wantedState !== 0) {
            if (stateInWorld === 0 && this.placeTargetIsAir) { // Or other types off air
              this.actions.push({ type: 'place', pos: cursor.clone(), state: wantedState })
              continue
            }
            if (((this.blockMatchStrictness === 'same_state' && stateInWorld !== wantedState) || (wantedBlock?.name !== blockInWorld?.name)) &&
              this.breakTargetShouldBeDifferent) {
              this.actions.push({ type: 'dig', pos: cursor.clone() })
              this.actions.push({ type: 'place', pos: cursor.clone(), dependsOn: cursor.clone(), state: wantedState })
              continue
            }
            /**
            if (stateInWorld !== wantedState && this.placeTargetIsReplaceable TODO && isReplacable(stateInWorld)) {

            } */
          }
        }
      }
    }
  }

  updateBlock (pos) {
    // is in area ?
    this.updateActions()
  }

  getItemForState (stateId) {
    return this.items[stateId]
  }

  getFacing (stateId, facing) {
    if (!facing) return { facing: null, faceDirection: false, is3D: false }
    const block = this.blocks[stateId]
    const data = facingData[block.name]
    if (data.inverted) {
      if (facing === 'up') facing = 'down'
      else if (facing === 'down') facing = 'up'
      else if (facing === 'north') facing = 'south'
      else if (facing === 'south') facing = 'north'
      else if (facing === 'west') facing = 'east'
      else if (facing === 'east') facing = 'west'
    }
    return { facing, faceDirection: data.faceDirection, is3D: data.is3D }
  }

  getPossibleDirections (stateId, pos) {
    const faces = [true, true, true, true, true, true]
    const properties = this.properties[stateId]
    const block = this.blocks[stateId]
    if (properties.axis) {
      if (properties.axis === 'x') faces[0] = faces[1] = faces[2] = faces[3] = false
      if (properties.axis === 'y') faces[2] = faces[3] = faces[4] = faces[5] = false
      if (properties.axis === 'z') faces[0] = faces[1] = faces[4] = faces[5] = false
    }
    if (properties.half === 'upper') return []
    if (properties.half === 'top' || properties.type === 'top') faces[0] = faces[1] = false
    if (properties.half === 'bottom' || properties.type === 'bottom') faces[0] = faces[1] = false
    if (properties.facing) {
      const { facing, faceDirection } = this.getFacing(stateId, properties.facing)
      if (faceDirection) {
        if (facing === 'north') faces[0] = faces[1] = faces[2] = faces[4] = faces[5] = false
        else if (facing === 'south') faces[0] = faces[1] = faces[3] = faces[4] = faces[5] = false
        else if (facing === 'west') faces[0] = faces[1] = faces[2] = faces[3] = faces[4] = false
        else if (facing === 'east') faces[0] = faces[1] = faces[2] = faces[3] = faces[5] = false
        else if (facing === 'up') faces[1] = faces[2] = faces[3] = faces[4] = faces[5] = false
        else if (facing === 'down') faces[0] = faces[2] = faces[3] = faces[4] = faces[5] = false
      }
    }
    if (properties.hanging) faces[0] = faces[2] = faces[3] = faces[4] = faces[5] = false
    if (block.material === 'plant') faces[1] = faces[2] = faces[3] = faces[4] = faces[5] = false

    let dirs = []
    const faceDir = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1),
      new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
    for (let i = 0; i < faces.length; i++) {
      if (faces[i]) dirs.push(faceDir[i])
    }

    const half = properties.half ? properties.half : properties.type
    dirs = dirs.filter(dir => {
      const block = this.world.getBlock(pos.plus(dir))
      if (!block) return false
      return getShapeFaceCenters(block.shapes, dir.scaled(-1), half).length > 0
    })

    return dirs
  }

  removeAction (action) {
    this.actions.splice(this.actions.indexOf(action), 1)
  }

  getAvailableActions () {
    return this.actions.filter(action => {
      if (action.type === 'dig') return true // TODO: check
      // if (action.dependsOn) {
      //   if (this.actions.find(a => a.pos.x === action.dependsOn.x && a.pos.y === action.dependsOn.y && a.pos.z === action.dependsOn.z)) {
      //     return false
      //   } return true
      // }
      if (this.getPossibleDirections(action.state, action.pos).length > 0) return true
      return false
    })
  }
}

module.exports = Build
