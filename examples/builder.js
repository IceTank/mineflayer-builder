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

let OBSIDIAN_ITEM, ECHEST_ITEM
let OSIDIAN_BLOCK, ECHEST_BLOCK

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

  mData = mcData(bot.version)

  OBSIDIAN_ITEM = mData.itemsByName['obsidian']
  ECHEST_ITEM = mData.itemsByName['ender_chest']
  ECHEST_BLOCK = mData.blocksByName['ender_chest']
  OSIDIAN_BLOCK = mData.blocksByName['obsidian']

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
    } else if (message === 'stop') {
      bot.builder.stop()
    } else if (message === 'pause') {
      bot.builder.pause()
    } else if (message === 'continue') {
      bot.builder.continue()
    }
  })
})

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
    resolve()
  } catch (e) {
    console.error(e)
    reject()
  }
}

async function findEmptyValidPos() {
  const iter = new Iterators.OctahedronIterator(bot.entity.position.offset(0, -1, 0), 5)
  let pos = iter.next()
  while (pos) {
    if (bot.entity.position.floored().manhattanDistanceTo(pos) > 1) {
      if (bot.blockAt(pos).boundingBox === 'block' && bot.blockAt(pos.offset(0, 1, 0)).boundingBox === 'empty') {
        return bot.blockAt(pos.offset(0, 1, 0))
      }
    }
    pos = iter.next()
  }
  return null
}

async function checkInv() {
  console.info('Checking inventory')
  const obsidianInInv = bot.inventory.findInventoryItem(OBSIDIAN_ITEM.id, null)
  console.info('Obsidian in inventory', obsidianInInv)
  if (!obsidianInInv) {
    console.info('Mining obsidian')
    const eChestCount = bot.inventory.countRange(bot.inventory.inventoryStart, bot.inventory.inventoryEnd, ECHEST_ITEM.id)
    if (eChestCount < 2) {
      throw Error('No echests left')
    }
    while (bot.inventory.emptySlotCount() > 0) {
      if (bot.inventory.count(ECHEST_ITEM.id) < 2) {
        throw Error('No e chests left')
      }
      try {
        let eChestBlock = bot.findBlock({
          matching: ECHEST_BLOCK.id,
          maxDistance: 5
        })
        if (!eChestBlock) {
          console.info('No echest near by placing one')
          let eBlockPos = await findEmptyValidPos()
          if (eBlockPos) {
            console.info('found', eBlockPos.position)
            const goal = new goals.GoalPlaceBlock(eBlockPos.position, bot.world, { range: 2 })
            if (!goal.isEnd(bot.entity.position.floored())) {
              await bot.pathfinder.goto(goal)
            }
            console.info('Equiping e chest', bot.inventory.findInventoryItem(ECHEST_ITEM.id))
            await bot.equip(bot.inventory.findInventoryItem(ECHEST_ITEM.id), 'hand')
            console.info('placing e chest')
            await bot.placeBlock(bot.blockAt(eBlockPos.position.offset(0, -1, 0)), new Vec3(0, 1, 0))
            eChestBlock = bot.blockAt(eBlockPos.position)
            if (!eChestBlock) {
              throw Error('Block vanished')
            }
          } else {
            throw Error('No enderchest placement position found')
          }
        }
        console.info('digging e chest')
        let goalTo = new goals.GoalGetToBlock(eChestBlock.position.x, eChestBlock.position.y, eChestBlock.position.z)
        if (!goalTo.isEnd(bot.entity.position.floored())) {
          await bot.pathfinder.goto(goalTo)
        }
        await bot.equip(bot.pathfinder.bestHarvestTool(eChestBlock))
        await bot.dig(eChestBlock)
        await wait(500)
      } catch (e) {
        console.error('Placment error while placing ender chest', e)
        await wait(500)
      }
    }
  }
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
