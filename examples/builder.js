const path = require('path')
const fs = require('fs').promises
const { builder, Build } = require('mineflayer-builder')
const { Schematic } = require('prismarine-schematic')
const { pathfinder, goals } = require('../mineflayer-pathfinder')
const mineflayer = require('mineflayer')
const mineflayerViewer = require('prismarine-viewer').mineflayer
const mcData = require('minecraft-data')
const Iterators = require('prismarine-world').iterators
const { Vec3 } = require('vec3')
const { simplify } = require('prismarine-nbt')

const TO_KEEP_OBSIDIAN = 1 * 64
const TO_KEEP_ECHEST = 64
const TO_KEEP_DIAMOND_PICK = 2

/** @type {import('prismarine-item').Item} */
let OBSIDIAN_ITEM
/** @type {import('prismarine-item').Item} */
let ECHEST_ITEM
/** @type {import('prismarine-item').Item} */
let DIAMOND_PICK
/** @type {import('prismarine-block').Block} */
let OSIDIAN_BLOCK, ECHEST_BLOCK
/** @type {[import('prismarine-item')]} */
let ARRAY_SHULKERS_ID

let Data
let Item
let Block

let eChestPosCache = null
let eChestHoleCache = null

/** @type {import('mineflayer').Bot} */
const bot = mineflayer.createBot({
  host: process.argv[2] || 'localhost',
  port: parseInt(process.argv[3]) || 25565,
  username: process.argv[4] || 'builder',
  password: process.argv[5]
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(builder)

function wait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

bot.once('spawn', async () => {
  mineflayerViewer(bot, { port: 3000 })

  Data = mcData(bot.version)

  OBSIDIAN_ITEM = Data.itemsByName['obsidian']
  ECHEST_ITEM = Data.itemsByName['ender_chest']
  DIAMOND_PICK = Data.itemsByName['diamond_pickaxe']
  /** @type {[import('prismarine-item').Item]} */
  ARRAY_SHULKERS_ID = []
  for (let i = 431; i <= 447; i++) {
    ARRAY_SHULKERS_ID.push(Data.items[i].id)
  }

  /** @type {pBlock} */
  ECHEST_BLOCK = Data.blocksByName['ender_chest']
  /** @type {pBlock} */
  OSIDIAN_BLOCK = Data.blocksByName['obsidian']

  Item = require('prismarine-item')(bot.version)
  Block = require('prismarine-block')(bot.version)
  

  bot.on('path_update', (r) => {
    const path = [bot.entity.position.offset(0, 0.5, 0)]
    for (const node of r.path) {
      path.push({ x: node.x, y: node.y + 0.5, z: node.z })
    }
    bot.viewer.drawLine('path', path, 0xff00ff)
  })

  while (!bot.entity.onGround) {
    await wait(100)
  }
  bot.on('messagestr', (message, messagePosition, jsonMsg) => {
    if (message.includes('start')) {
      start()
    } 
  })
  bot.on('chat', async (username, message) => {
    console.info(username, message)
    if (message.startsWith('build')) {
      const [, schematicName] = message.split(' ')
      build(schematicName)
    } else if (message === 'test') {
      checkInv()
    } else if (message === 'count') {
      console.info(countInventoryItem(DIAMOND_PICK.id))
    } else if (message.startsWith('sky')) {
      // const [, chunkX, chunkZ] = message.split(' ')
      // if (!chunkX || !chunkZ || isNaN(chunkX) || isNaN(chunkZ)) return console.error('Invalid arguments')
      // coverTheSky(chunkX, chunkZ)
      coverTheSky(-5, -11)
    } else if (message === 'stop') {
      bot.builder.stop()
    } else if (message === 'pause') {
      bot.builder.pause()
    } else if (message === 'continue') {
      bot.builder.continue()
    }
  })
})

async function coverTheSky(chunkX, chunkZ) {
  const startChunk = new Vec3(Number(chunkX), 0, Number(chunkZ))
  const maxChunkDist = 4
  const buildHeight = 100
  let chunkCursorIter = new CubeIterator2d(new Vec3(startChunk.x, 0, startChunk.z), maxChunkDist)
  let currentChunk = chunkCursorIter.next()
  console.info('Start chunk', currentChunk)
  const filePath = path.resolve(__dirname, '../schematics/chunkObi.schem')
  if (!fileExists(filePath)) {
    bot.chat(`File ${schematicName} not found`)
    return
  }
  // const goal = new goals.GoalY(100)
  // bot.pathfinder.setGoal(goal)
  // await new Promise((r) => bot.once('goal_reached', r))
  const chunkSchematic = await Schematic.read(await fs.readFile(filePath), bot.version)
  while (currentChunk) {
    // fill chunk
    let at = currentChunk.scaled(16).offset(0, buildHeight, 0)
    console.info('Building at ', at)
    const build = new Build(chunkSchematic, bot.world, at)
    bot.builder.build(build, noMaterial)
    await new Promise((r) => bot.once('builder_finished', r))
    console.info('Finished chunk', currentChunk)
    await wait(50)
    currentChunk = chunkCursorIter.next()
  }
}

async function build (name) {
  const schematicName = !name.endsWith('.schem') ? name + '.schem' : name
  const filePath = path.resolve(__dirname, '../schematics/' + schematicName)
  if (!fileExists(filePath)) {
    bot.chat(`File ${schematicName} not found`)
    return
  }
  const schematic = await Schematic.read(await fs.readFile(filePath), bot.version)
  const at = bot.entity.position.floored()
  bot.chat('Building at ', at)
  const build = new Build(schematic, bot.world, at)
  bot.builder.build(build, noMaterial)
}

async function noMaterial (item, resolve, reject) {
  console.info('Building interrupted missing', item?.name)
  try {
    await checkInv()
    console.info('Inventory check finished')
    resolve()
  } catch (e) {
    console.error(e)
    reject()
  }
}

/**
 * Returns a new Error with message `no_echest`
 * @returns {Error} Error with message = `no_echest`
 */
 function newErrorNoEChest() {
  const e = new Error()
  e.message = 'no_echest'
  return e
}

/**
 * Returns a new error with the missing shulker type.
 * @param {string} shulkerType Name of the missing shulker
 * @returns Error with message `no_shulker_<shlkerType>`
 */
function newErrorNoShulkers(shulkerType) {
  const e = new Error()
  e.message = 'no_shulker_' + shulkerType
  return e
}

function getInventoryItem(id) {
  for (const i of bot.inventory.slots) {
    if (i && i.type === id) return i
  }
  return null
}

/**
 * Searches the inventory for multiple different ids and returns all results.
 * @param {[import('prismarine-item').Item]} result Matching items from the inventory
 */
function getAllInventoryItems(ids) {
  debugger
  let result = []
  for (const slotItem of bot.inventory.slots) {
    if (!slotItem) continue
    for (let searchId of ids) {
      if (slotItem && searchId === slotItem.type) result.push(slotItem)
    }
  }
  return result
}

/**
 * Counts the amount of items present in the inventory by matching id.
 * @param {number} id The item id to look for
 * @param {import('prismarine-windows').Window} window The current window instance
 * @returns number
 */
function countInventoryItem(id, window) {
  let win = window
  if (!window) win = bot.inventory
  let count = 0
  for (let i = win.inventoryStart; i < win.inventoryEnd; i++) {
    if (win.slots[i] && win.slots[i].type === id) count += win.slots[i].count
  }
  return count
}

/**
 * Scanns the bots area for valid places to place a container on like shulker boxes or EChests.
 * @returns {null | import('prismarine-block').Block} 
 */
function findValidContainerPos() {
  const iter = new Iterators.OctahedronIterator(bot.entity.position.offset(0, -1, 0), 4)
  let pos = iter.next()
  while (pos) {
    if (bot.entity.position.floored().manhattanDistanceTo(pos) > 1) {
      if (bot.blockAt(pos).boundingBox === 'block' && bot.blockAt(pos.offset(0, 1, 0)).boundingBox === 'empty' && bot.blockAt(pos.offset(0, 2, 0)).boundingBox === 'empty') {
        // Check for 3x3 plattform
        if (checkIsPlatform(pos)) {
          return bot.blockAt(pos.offset(0, 1, 0))
        }
      }
    }
    pos = iter.next()
  }
  return null
}

function matcherValidContainerPos(pos) {
  if (bot.entity.position.floored().manhattanDistanceTo(pos) > 1) {
    if (bot.blockAt(pos).boundingBox === 'block' && bot.blockAt(pos.offset(0, 1, 0)).boundingBox === 'empty' && bot.blockAt(pos.offset(0, 2, 0)).boundingBox === 'empty') {
      // Check for 3x3 plattform
      if (checkIsPlatform(pos)) return true
    }
  }
  return false
}

/**
 * @callback MatcherFunction
 * @param {import('vec3').Vec3} pos Center pos
 * @returns {boolean}
 */

/**
 * Finds positions that are valid for a given matcher function.
 * @param {import('vec3').Vec3} startingPos The starting position
 * @param {number} distance Maximum distance
 * @param {MatcherFunction} matcher Function that checks if the given coordinates are valid
 * @returns 
 */
async function findPositionForMatch(startingPos, distance, matcher) {
  const iter = new Iterators.OctahedronIterator(startingPos, distance)
  let pos = iter.next()
  while (pos) {
    if (matcher(pos)) return pos
    pos = iter.next()
  }
  return null
}

/**
 * Checks if the target pos has a 3x3 platform around it. Useful if stuff should not fall off off edges.
 * @param {import('vec3').Vec3} pos The center pos off the platform 
 * @returns {boolean} if it is a 3x3 platform
 */
async function checkIsPlatform (pos) {
  for (let i = -1; i < 2; i++) {
    for (let k = -1; k < 2; k++) {
      if (bot.blockAt(pos.offset(i, 0, k)).boundingBox !== 'block') return false
    }
  }
  return true
}

const matcherIsPlatform = checkIsPlatform

/**
 * Check if a given position is platform with a hole in it.
 * @param {import('vec3').Vec3} pos Center position
 * @returns boolean
 */
 async function matcherIsEChestHole(pos) {
  for (let i = -1; i < 2; i++) {
    for (let k = -1; k < 2; k++) {
      if (i === 0 && k === 0) continue
      let block = bot.blockAt(pos.offset(i, 0, k))
      if (!block || (block && block.boundingBox !== 'block')) return false
    }
  }
  if (bot.blockAt(pos.offset(0, -1, 0)).boundingBox === 'block') return true
  return false
}

/**
 * Builds a Donut to mine EChests.
 * @param {import('vec3').Vec3} pos The center position with the hole
 * @returns {import('vec3').Vec3} The center position
 */
 async function createEChestPlatform(pos) {
  let centerBlock = bot.blockAt(pos)

  // Check if the block the echest is placed on exists
  if (!bot.blockAt(centerBlock.position.offset(0, -1, 0))) {
    // Check if the center block exists
    if (!centerBlock) throw Error('position_not_valid')
    await bot.placeBlock(centerBlock.position, new Vec3(0, -1, 0))
    bot.pathfinder.bestHarvestTool(centerBlock)
    await bot.dig(centerBlock)
  }
  return centerBlock.position
} 

/**
 * Places a container in a given location.
 * @param {import('vec3').Vec3} pos The pos to place the container.
 * @param {import('prismarine-item').Item} item The item to place.
 * @returns {import('prismarine-block').Block} The placed block.
 */
async function placeContainer (pos, item) {
  const goal = new goals.GoalPlaceBlock(pos, bot.world, { range: 2 })
  if (!goal.isEnd(bot.entity.position.floored())) {
    await bot.pathfinder.goto(goal)
  }
  await bot.equip(item, 'hand')
  await bot.placeBlock(bot.blockAt(pos.offset(0, -1, 0)), new Vec3(0, 1, 0))
  await wait(200)
  return bot.blockAt(pos)
}

/**
 * Finds and places EChests in a valid position. Throws if no position is found or it ran out of EChests.
 * @param {import('vec3').Vec3} pos Position
 * @returns {import('prismarine-block').Block} The placed EChest block.
 */
async function placeEChest (pos) {
  if (!pos) throw Error('No pos given')
  console.info('placeEChest', pos)
  let eChestBlock = bot.blockAt(pos)
  if (eChestBlock?.type === ECHEST_BLOCK.id) return eChestBlock
  if (eChestBlock && eChestBlock.type !== ECHEST_BLOCK.id) {
    await bot.equip(bot.pathfinder.bestHarvestTool(eChestBlock))
    await bot.dig(eChestBlock)
  }
  
  let itemInv = getInventoryItem(ECHEST_ITEM.id)
  if (!itemInv) {
    throw newErrorNoEChest()
  }
  await bot.equip(ECHEST_ITEM.id)
  await bot.placeBlock(bot.blockAt(pos.offset(0, -1, 0)), new Vec3(0, 1, 0))
  eChestBlock = bot.blockAt(pos)
  if (!eChestBlock) {
    throw Error('Block vanished')
  }
  return eChestBlock
  
}

/**
 * Places and Mines obsidian from EChests
 */
async function mineObi(amount = 64) {
  while (countInventoryItem(OBSIDIAN_ITEM.id) < amount) {
    if (countInventoryItem(ECHEST_ITEM.id) <= 2) throw newErrorNoEChest()
    if (bot.inventory.emptySlotCount() <= 2) throw Error('no_space_left')

    if (!eChestHoleCache || (eChestHoleCache && bot.entity.position.distanceTo(eChestHoleCache) > 10)) {
      console.info('No EChest hole cache searching for existing holes')
      eChestHoleCache = null
      let p = bot.entity.position.floored()
      p.y = 100
      let existingHole = await findPositionForMatch(p, 5, matcherIsEChestHole)
      console.info('Existing hole', existingHole)
      if (!existingHole) {
        console.info('No existion holes found creating a new hole')
        let newHole = findPositionForMatch(bot.entity.position.floored(), 5, matcherIsPlatform)
        if (!newHole) throw Error('no_echest_position_found')
        await createEChestPlatform(newHole)
        console.info('Created new hole')
        eChestHoleCache = newHole
      } else {
        eChestHoleCache = existingHole
      }
    }
    eChestPosCache = eChestHoleCache
    try {
      let p = eChestPosCache.offset(0, 1, 0)
      let goal = new goals.GoalGetToBlock(p.x, p.y, p.z)
      if (!goal.isEnd(bot.entity.position.floored())) {
        await bot.pathfinder.goto(goal)
      }
    } catch (e) {
      console.error('Got error while path finding', e)
      throw e
    }
    try {
      console.info('placing echest')
      await placeEChest(eChestPosCache)
      console.info('digging e chest')
      let goalTo = new goals.GoalGetToBlock(eChestPosCache.x, eChestPosCache.y + 1, eChestPosCache.z)
      if (!goalTo.isEnd(bot.entity.position.floored())) await bot.pathfinder.goto(goalTo)
      let eChestBlock = bot.blockAt(eChestPosCache)
      await bot.equip(bot.pathfinder.bestHarvestTool(eChestBlock))
      await bot.dig(eChestBlock)
      await wait(500)
    } catch (e) {
      if (e.message === 'no_echest') {
        throw e
      }
      console.error('Placment error while placing ender chest', e)
      await wait(500)
    }
  }
  console.info('Mining finished')
}

/**
 * Searches shulker items for item by id
 * @param {import('prismarine-item').Item} shulkerItem The shulker item 
 * @param {number} id The id to match 
 * @returns 
 */
function searchShulkerFor(shulkerItem, id) {
  if (!shulkerItem?.nbt) {
    console.info(shulkerItem, 'did not contain', id)
    return 0
  }
  
  const items = simplify(shulkerItem.nbt)?.BlockEntityTag?.Items
  if (!items || (items && items.length === 0)) {
    console.info('nbt length 0 or simplify failed', items)
    return 0
  }

  let found = 0

  for (const item of items) {
    if (Data.itemsByName[item.id.replace('minecraft:', '')].id === id) {
      found += item.count
    }
  }
  return found
}

/**
 * Resupply Diamond pickaxes from shulker boxes.
 */
async function resupplyPick() {
  if (countInventoryItem(DIAMOND_PICK.id) >= 2) {
    let pick_item = getInventoryItem(DIAMOND_PICK.id)
    if (pick_item) {
      await bot.equip(pick_item, 'hand')
      return
    }
  }
  let shulkers = getAllInventoryItems(ARRAY_SHULKERS_ID)
  // console.info('Found shulkers', shulkers)
  if (shulkers.length === 0) throw newErrorNoShulkers('pick')
  let shulkerWithItems = null
  for (const s of shulkers) {
    let found = searchShulkerFor(s, DIAMOND_PICK.id)
    if (found !== 0) {
      shulkerWithItems = s
      break
    }
  }
  if (!shulkerWithItems) throw newErrorNoEChest('pick')
  const validBlock = findValidContainerPos()
  if (!validBlock) { 
    throw Error('no valid position found')
  }
  console.info('Equipping', shulkerWithItems)
  let placedShulker = await placeContainer(validBlock.position, shulkerWithItems)
  await wait(500)
  await resupplyFromContainer(placedShulker, [new Item(DIAMOND_PICK.id, 2)])
  await wait(500)
  await bot.lookAt(placedShulker.position.offset(0.5, 1, 0.5), true)
  await bot.equip(bot.pathfinder.bestHarvestTool(bot.blockAt(placedShulker.position)), 'hand')
  await bot.dig(placedShulker)
}

/**
 * Resupplys EChests from shulker boxes.
 * @param {number} count Amount to resupply
 */
async function resupplyEChest(count = 2) {
  if (countInventoryItem(ECHEST_ITEM.id) >= count) return
  let shulkers = getAllInventoryItems(ARRAY_SHULKERS_ID)
  // console.info('Found shulkers', shulkers)
  if (shulkers.length === 0) throw newErrorNoShulkers('echest')
  let shulkerWithItems = null
  for (const s of shulkers) {
    let found = searchShulkerFor(s, ECHEST_ITEM.id)
    if (found !== 0) {
      shulkerWithItems = s
      break
    }
  }
  if (!shulkerWithItems) throw newErrorNoEChest('pick')
  const validBlock = findValidContainerPos()
  if (!validBlock) { 
    throw Error('no valid position found')
  }
  console.info('Equipping', shulkerWithItems)
  let placedShulker = await placeContainer(validBlock.position, shulkerWithItems)
  await wait(500)
  await resupplyFromContainer(placedShulker, [new Item(ECHEST_ITEM.id, count)])
  await wait(500)
  await bot.lookAt(placedShulker.position.offset(0.5, 1, 0.5), true)
  await bot.equip(bot.pathfinder.bestHarvestTool(bot.blockAt(placedShulker.position)), 'hand')
  await bot.dig(placedShulker)
  await wait(1000)
}

async function checkInv() {
  console.info('Checking inventory')

  while (true) {
    await wait(500)
    if (countInventoryItem(DIAMOND_PICK.id) < TO_KEEP_DIAMOND_PICK) {
      console.info('Start resupply Pick')
      await resupplyPick()
      console.info('End resupply pick')
    }

    if (countInventoryItem(ECHEST_ITEM.id) < TO_KEEP_ECHEST) {
      console.info('Start resupply EChest')
      await resupplyEChest(TO_KEEP_ECHEST)
      console.info('End resupply EChest')
    }

    if (countInventoryItem(OBSIDIAN_ITEM.id) < TO_KEEP_OBSIDIAN) {
      if (countInventoryItem(ECHEST_ITEM.id) < TO_KEEP_ECHEST) continue
      try {
        console.info('mining obisidian')
        await mineObi(TO_KEEP_OBSIDIAN * 4)
      } catch (e) {
        if (e.message !== 'no_echest' && e.message !== 'no_space_left') throw e
      }
      continue
    }
    break
  }
}

/**
 * Resupplys or pulls items from a block container like shulkers or ender chests.
 * @param {import('prismarine-block').Block} containerBlock The container block instance
 * @param {[import('prismarine-item').Item]} items The items to pull form the container 
 */
async function resupplyFromContainer(containerBlock, items) {
  console.info('Resupply from container', items)
  if (!bot.blockAt(containerBlock.position)) {
    console.error('Invalid contianer block', containerBlock)
    throw Error('No valid block to resupply from')
  }
  
  try {
    const goal = new goals.GoalGetToBlock(containerBlock.position.x, containerBlock.position.y, containerBlock.position.z)
    if (!goal.isEnd(bot.entity.position.floored())) {
      await bot.pathfinder.goto(goal)
      console.info('Travel finished')
    }
  } catch (e) {
    console.error(e)
    console.info('Travel error')
    return
  }

  const container = await bot.openContainer(containerBlock)
  // only use search inventory with the right window context from here on out
  await wait(500)

  console.info('container content', containerBlock.position, container.slots.filter(slot => !!slot).length, 'items')
  
  // Check items to search for
  for (const searchItem of items) {
    // If target count is reached skip
    if (countInventoryItem(searchItem.type, container) >= searchItem.count) continue
    // Shulker/EChest item content layout: [0 container.inventoryStart[ 
    for (let i = 0; i < container.inventoryStart; i++) {
      /** @type {import('prismarine-item').Item} */
      let containerItem = container.slots[i]
      if (!containerItem) continue
      if (containerItem.type !== searchItem.type) continue
      let toPull = Math.min(searchItem.count - countInventoryItem(searchItem.type, container), 64)
      // console.info('toPull round 1', toPull, 'in inv', countInventoryItem(searchItem.type, container))
      toPull = Math.min(toPull, containerItem.count)
      // console.info('toPull round 2', toPull)
      if (toPull <= 0) break
      console.info('pulled item', containerItem.name, toPull)
      await container.withdraw(containerItem.type, null, toPull)
      await wait(100)
    }
  }
  await container.close()
  return
} 

async function start () {
  bot.chat('/clear')
  await wait(1000)
  bot.chat('/give builder dirt')
  await wait(1000)
  bot.chat('/fill 187 4 122 209 30 101 air')
  await wait(1000)
  bot.chat('/tp 197 4 121')
  await wait(1000)
  const at = bot.entity.position.floored()
  console.log('Building at ', at)
  const build = new Build(schematic, bot.world, at)
  bot.builder.build(build)
}

async function fileExists (path) {  
  try {
    await fs.promises.access(path)
    return true
  } catch {
    return false
  }
}

class CubeIterator2d {
  /**
   * Spiral outwards from a central position in growing squares.
   * Generates positions like this:
   * ```text
   * 16 15 14 13 12
   * 17  4  3  2 11
   * 18  5  0  1 10
   * 19  6  7  8  9
   * 20 21 22 23 24
   * (maxDistance = 2; points returned = 25)
   * ```
   * Copy and past warrior source: https://stackoverflow.com/questions/3706219/algorithm-for-iterating-over-an-outward-spiral-on-a-discrete-2d-grid-from-the-or
   * @param {Vec3} pos Starting position
   * @param {number} maxDistance Max distance from starting position
   */
  constructor (pos, maxDistance) {
    this.start = pos
    this.maxDistance = maxDistance

    this.NUMBER_OF_POINTS = Math.floor(Math.pow((Math.floor(maxDistance) - 0.5) * 2, 2))

    // (di, dj) is a vector - direction in which we move right now
    this.di = 1
    this.dj = 0
    // length of current segment
    this.segment_length = 1
    // current position (i, j) and how much of current segment we passed
    this.i = 0
    this.j = 0
    this.segment_passed = 0
    // current iteration
    this.k = 0
  }

  next () {
    if (this.k >= this.NUMBER_OF_POINTS) return null
    const output = this.start.offset(this.i, 0, this.j)

    // make a step, add 'direction' vector (di, dj) to current position (i, j)
    this.i += this.di
    this.j += this.dj
    this.segment_passed += 1

    if (this.segment_passed === this.segment_length) {
      // done with current segment
      this.segment_passed = 0

      // 'rotate' directions
      const buffer = this.di
      this.di = -this.dj
      this.dj = buffer

      // increase segment length if necessary
      if (this.dj === 0) {
        this.segment_length += 1
      }
    }
    this.k += 1
    return output
  }
}
