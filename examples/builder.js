const path = require('path')
const fs = require('fs').promises
const { builder, Build } = require('mineflayer-builder')
const { Schematic } = require('prismarine-schematic')
const { pathfinder } = require('mineflayer-pathfinder')
const mineflayer = require('mineflayer')
const mineflayerViewer = require('prismarine-viewer').mineflayer

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

  bot.on('goal_updated', (newGoal) => {
    console.info('Goal updated', newGoal?.constructor)
  })

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
  bot.on('chat', async (username, message) => {
    console.info(username, message)
    if (message.startsWith('build')) {
      const [, schematicName] = message.split(' ')
      build(schematicName || 'smallhouse1')
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
  build.breakTargetShouldBeAir = true
  build.breakTargetShouldBeDifferent = true
  build.updateActions()
  let res
  while (!res || res.data.error === 'missing_material') {
    try {
      if (res?.data?.error === 'missing_material') {
        if (bot.inventory.emptySlotCount() <= 1) {
          bot.chat('/clear')
          await wait(100)
          bot.chat(`/give ${bot.username} diamond_pickaxe`)
          bot.chat(`/give ${bot.username} dirt 64`)
        }
        bot.chat(`/give ${bot.username} ${res.data.item.name} 64`)
        await wait(500)
      }
      res = await bot.builder.build(build)
    } catch (err) {
      console.info('Builder got error while building', err)
    }
  }
  console.info('Builder finished with result', res)
}

async function fileExists (path) {
  try {
    await fs.promises.access(path)
    return true
  } catch {
    return false
  }
}
