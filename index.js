const { goals, Movements } = require('mineflayer-pathfinder')

const interactable = require('./lib/interactable.json')

function wait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

/**
 * @param {function} func 
 * @param {number} timeout 
 * @param  {...any} args 
 * @throws
 * @returns {Promise<void>}
 */
async function awaitWithTimeout(func, timeout, ...args) {
  const timeoutHandle = new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
  await Promise.race([func(...args), timeoutHandle]) 
}

/**
 * @typedef BuildError
 * @property {Error} error
 * @property {object} data
 */

/**
 *
 * @param {import('mineflayer').Bot & {pathfinder: import('mineflayer-pathfinder').Pathfinder} & import('mineflayer-builder').Builder} bot Bot
 */
function inject (bot) {
  if (!bot.pathfinder) {
    throw new Error('pathfinder must be loaded before builder')
  }

  let interruptBuilding = false

  const mcData = require('minecraft-data')(bot.version)
  const Item = require('prismarine-item')(bot.version)

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

  /**
   * @param {import('mineflayer-builder').Build} build Build to build
   * @param {import('.').BuildOptions?} options Build options
   * @returns {import('mineflayer-builder').BuildReturnObject}
   */
  bot.builder.build = async function (build, options = {}) {
    /** @type {BuildError} */
    let buildError
    bot.builder.currentBuild = build

    const oldMovements = bot.pathfinder.movements
    const movements = new Movements(bot, mcData)
    // movements.canDig = false
    movements.digCost = 3
    movements.maxDropDown = 3
    movements.placeCost = 3

    bot.pathfinder.searchRadius = 10

    bot.pathfinder.setMovements(movements)

    const resetMovements = () => {
      bot.pathfinder.setMovements(oldMovements)
    }

    const placementRange = options.range || 3
    const placementLOS = 'LOS' in options ? options.LOS : true
    const materialMin = options.materialMin || 0
    const placeOrderFunc = options.placeSort || null

    interruptBuilding = false

    /**
     *
     * @param {string} name name
     * @param {object?} data data
     * @returns {BuildError}
     */
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
     * @returns {import('mineflayer-builder').BuildReturnObject}
     */
    function newReturnObj (failed, data = {}) {
      return {
        status: failed ? 'finished' : 'cancel',
        data: data
      }
    }

    function actionHash (action) {
      return `${action.pos.x},${action.pos.y},${action.pos.z}`
    }

    const placeErrors = {}

    while (true) {
      if (interruptBuilding) {
        interruptBuilding = false
        resetMovements()
        return newReturnObj(false)
      }
      let actions = build.getAvailableActions()
      if (actions.length === 0) {
        if (!build.isDynamic) break // No more actions to do
        bot.chat('Updating actions')
        build.updateActions()
        // build.updateActions(bot.entity.position.floored())
        actions = build.getAvailableActions()
        if (actions.length === 0) {
          return newReturnObj(false)
        }
      }
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
          const blockInWorld = bot.blockAt(action.pos)
          if (blockInWorld.stateId === action.state) {
            build.removeAction(action)
            console.info('Got action that wants to place an already placed block', action)
            continue
          }
          if (blockInWorld.type !== 0) {
            build.removeAction(action)
            console.info('Got action that wants to place a block in a none air block', action)
            continue
          }
          const item = build.getItemForState(action.state)
          if (!item) throw new Error('Item for state ' + JSON.stringify(action) + ' returned nullish')
          console.log('Selecting ' + item?.displayName)

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
            // bot.pathfinder.setMovements(movements)
            try {
              await awaitWithTimeout(bot.pathfinder.goto, 5000 + 2000 * bot.entity.position.distanceTo(action.pos), goal)
            } catch (err) {
              if (err.message === 'timeout') {
                console.warn('Pathfing timed out removing action', action)
                build.removeAction(action)
                continue
              }
              throw err
            }
            console.log('finished pathing')
          }

          try {
            const amount = bot.inventory.count(item.id)
            if (bot.game.gameMode === 'creative') {
              await equipCreative(item.id)
            } else {
              if (amount <= materialMin) throw Error('no_blocks')
              await equipItem(item.id) // equip item after pathfinder
              await wait(100)
            }
          } catch (e) {
            if (e.message === 'no_blocks') {
              buildError = newBuildError('missing_material', { item })
              break
            }
            await wait(100)
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
          console.info('Going to goal break')
          try {
            await awaitWithTimeout(bot.pathfinder.goto, 5000 + 2000 * bot.entity.position.distanceTo(action.pos), new goals.GoalBreakBlock(action.pos.x, action.pos.y, action.pos.z, bot))
          } catch (err) {
            if (err.message === 'timeout') {
              console.warn('Pathfing timed out removing action', action)
              build.removeAction(action)
              continue
            }
            throw err
          }
          console.info('Finished going to goal break')
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
          if (!placeErrors[hash]) placeErrors[hash] = 0
          placeErrors[hash] += 1
          if (placeErrors[hash] > 5) {
            console.info('Too many failed place attempts removing action')
            build.removeAction(action)
          }
          continue
        } else if (e?.message.startsWith('must be holding')) { // Item place error
          continue
        } else if (e?.message.startsWith('Server rejected transaction')) { // Inventory clicking to fast
          await wait(200)
          continue
        } else {
          console.error(e?.name, e)
        }
        build.removeAction(action)
      }
    }

    if (buildError) {
      bot.builder.currentBuild = null
      if (buildError.error.message === 'missing_material') {
        resetMovements()
        return newReturnObj(false, {
          error: 'missing_material',
          item: buildError.data.item
        })
      }
      resetMovements()
      return newReturnObj(false)
    }

    // bot.chat('Finished building')
    bot.builder.currentBuild = null
    resetMovements()
    return newReturnObj(true)
  }
}

module.exports = {
  Build: require('./lib/Build'),
  builder: inject
}
