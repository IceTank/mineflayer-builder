const { goals, Movements } = require('mineflayer-pathfinder')

const interactable = require('./lib/interactable.json')

/**
 * @typedef {object} returnObject Return status object
 * @property {string} status Ether `cancel` or `finished`
 *
 */

/**
 * @typedef {object} buildOptions Build options for `build`
 * @property {number?} range Default: 3 - Range the bot can place blocks at
 * @property {boolean?} LOS Default: `true` - If the bot should use line of sight when placing blocks
 * @property {number?} materialMin Default: 0 - The point at witch build cancels for lack of materials
 */

function wait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function inject (bot) {
  if (!bot.pathfinder) {
    throw new Error('pathfinder must be loaded before builder')
  }

  let interruptBuilding = false

  const mcData = require('minecraft-data')(bot.version)
  const Item = require('prismarine-item')(bot.version)

  const movements = new Movements(bot, mcData)
  // movements.canDig = false
  movements.digCost = 10
  movements.maxDropDown = 3
  bot.pathfinder.searchRadius = 10

  bot.builder = {}

  bot.builder.currentBuild = null

  async function equipCreative (id) {
    if (bot.inventory.items().length > 30) {
      bot.chat('/clear')
      await wait(1000)
      const slot = bot.inventory.firstEmptyInventorySlot()
      await bot.creative.setInventorySlot(slot !== null ? slot : 36, new Item(mcData.itemsByName.dirt.id, 1))
    }
    if (!bot.inventory.items().find(x => x.type === id)) {
      const slot = bot.inventory.firstEmptyInventorySlot()
      await bot.creative.setInventorySlot(slot !== null ? slot : 36, new Item(id, 1))
    }
    const item = bot.inventory.items().find(x => x.type === id)
    await bot.equip(item, 'hand')
  }

  async function equipItem (id) {
    if (bot.heldItem?.type === id) return
    const item = bot.inventory.findInventoryItem(id, null)
    if (!item) {
      throw Error('no_blocks')
    }
    await bot.equip(item.type, 'hand')
  }

  bot.builder.equipItem = equipItem

  bot.builder.stop = function () {
    console.log('Stopped building')
    interruptBuilding = true
    bot.builder.currentBuild = null
    bot.pathfinder.setGoal(null)
  }

  bot.builder.pause = function () {
    console.log('Paused building')
    interruptBuilding = true
    bot.pathfinder.setGoal(null)
  }

  bot.builder.continue = () => {
    if (!bot.builder.currentBuild) return console.log('Nothing to continue building')
    bot.builder.build(bot.builder.currentBuild)
  }

  // /fill ~-20 ~ ~-20 ~20 ~10 ~20 minecraft:air

  /**
   * @param {object} build Build to build
   * @param {buildOptions?} options Build options
   * @returns
   */
  bot.builder.build = async function (build, options = {}) {
    let buildError
    bot.builder.currentBuild = build

    const placementRange = options.range || 3
    const placementLOS = 'LOS' in options ? options.LOS : true
    const materialMin = options.materialMin || 0
    const placeOrderFunc = options.placeSort || null

    interruptBuilding = false

    function newBuildError (name, data = {}) {
      return {
        error: new Error(name),
        data: data
      }
    }

    /**
     *
     * @param {boolean} failed Failed or succeeded
     * @param {object} data Additional data
     * @returns {returnObject}
     */
    function newReturnObj (failed, data = {}) {
      return {
        status: failed ? 'finished' : 'cancel',
        data: data
      }
    }

    function actionHash(action) {
      return `${action.pos.x},${action.pos.y},${action.pos.z}`
    }

    let placeErrors = {}

    while (build.actions.length > 0) {
      if (interruptBuilding) {
        interruptBuilding = false
        return
      }
      const actions = build.getAvailableActions()
      console.log(`${actions.length} available actions`)
      if (actions.length === 0) {
        console.log('No actions to perform')
        break
      }
      if (placeOrderFunc) {
        actions.sort(placeOrderFunc)
      } else {
        actions.sort((a, b) => {
          let dA = a.pos.offset(0.5, 0.5, 0.5).distanceSquared(bot.entity.position)
          dA += (a.pos.y - bot.entity.position.y) * 100
          let dB = b.pos.offset(0.5, 0.5, 0.5).distanceSquared(bot.entity.position)
          dB += (b.pos.y - bot.entity.position.y) * 100
          return dA - dB
        })
      }
      const action = actions[0]
      const hash = actionHash(action)
      console.log('action', action)

      try {
        if (action.type === 'place') {
          const item = build.getItemForState(action.state)
          console.log('Selecting ' + item.displayName)

          const properties = build.properties[action.state]
          const half = properties.half ? properties.half : properties.type

          const faces = build.getPossibleDirections(action.state, action.pos)
          for (const face of faces) {
            const block = bot.blockAt(action.pos.plus(face))
            console.log(face, action.pos.plus(face), block.name)
          }

          const { facing, is3D } = build.getFacing(action.state, properties.facing)
          const goal = new goals.GoalPlaceBlock(action.pos, bot.world, {
            faces,
            facing: facing,
            facing3D: is3D,
            half,
            range: placementRange,
            LOS: placementLOS
          })
          if (!goal.isEnd(bot.entity.position.floored())) {
            console.log('pathfinding')
            bot.pathfinder.setMovements(movements)
            await bot.pathfinder.goto(goal)
            console.log('finished pathing')
          }

          try {
            const amount = bot.inventory.count(item.id)
            if (amount <= materialMin) throw Error('no_blocks')
            await equipItem(item.id) // equip item after pathfinder
          } catch (e) {
            if (e.message === 'no_blocks') {
              buildError = newBuildError('missing_material', { item })
              break
            }
            await wait(100)
            if (!placeErrors[hash]) placeErrors[hash] = 0
            placeErrors[hash] += 1
            throw e
          }

          // TODO: const faceAndRef = goal.getFaceAndRef(bot.entity.position.offset(0, 1.6, 0))
          const faceAndRef = goal.getFaceAndRef(bot.entity.position.floored().offset(0.5, 1.6, 0.5))
          if (!faceAndRef) { throw new Error('no face and ref') }

          bot.lookAt(faceAndRef.to, true)

          const refBlock = bot.blockAt(faceAndRef.ref)
          const sneak = interactable.indexOf(refBlock.name) > 0
          const delta = faceAndRef.to.minus(faceAndRef.ref)
          if (sneak) bot.setControlState('sneak', true)
          await bot._placeBlockWithOptions(refBlock, faceAndRef.face.scaled(-1), { half, delta })
          if (sneak) bot.setControlState('sneak', false)

          // const block = bot.world.getBlock(action.pos)
          const worldState = bot.world.getBlockStateId(action.pos)
          // Does not work for 1.12 as blocks dont have the stateId property
          if (worldState !== action.state) {
            console.log('expected', properties)
            console.log('got', worldState)
          }
          build.removeAction(action)
        } else if (action.type === 'dig') {
          await bot.pathfinder.goto(new goals.GoalNear(action.pos.x, action.pos.y, action.pos, placementRange))
          const blockToBreak = bot.blockAt(action.pos)
          const bestTool = bot.pathfinder.bestHarvestTool(blockToBreak)
          if (bestTool) await equipItem(bestTool.type)
          await bot.dig(bot.blockAt(action.pos))
          build.removeAction(action)
        } else {
          console.error('Unknown action', action)
          build.removeAction(action)
        }
      } catch (e) {
        if (e?.name === 'NoPath') {
          console.info('Skipping unreachable action', action)
        } else if (e?.message.startsWith('No block has been placed')) {
          console.info('Block placement failed')
          console.error(e)
          if (placeErrors[hash] && placeErrors[hash] > 5) {
            console.info('Too many failed place attempts removing action')
            build.removeAction(action)
          }
          continue
        } else {
          console.error(e?.name, e)
        }
        build.removeAction(action)
      }
    }

    if (buildError) {
      bot.builder.currentBuild = null
      if (buildError.message === 'missing_material') {
        return newReturnObj(false, {
          error: 'missing_material',
          item: buildError.data.item
        })
      }
      return newReturnObj(false)
    }

    bot.chat('Finished building')
    bot.builder.currentBuild = null
    return newReturnObj(true)
  }
}

module.exports = {
  Build: require('./lib/Build'),
  builder: inject
}
