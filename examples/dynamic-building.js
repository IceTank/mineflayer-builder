// Fix... Modulo. Javascript moment
Number.prototype.mod = function (n) {
  return ((this % n) + n) % n
}

const mf = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { builder, Build } = require('mineflayer-builder')
const fs = require('fs').promises
const { Schematic } = require('prismarine-schematic')
const { Vec3 } = require('vec3')

const bot = mf.createBot({
  host: 'localhost',
  username: 'wall-builder'
})

bot.once('spawn', async () => {
  bot.loadPlugins([pathfinder, builder])
  const mcData = require('minecraft-data')(bot.version)
  const defaultMove = new Movements(bot, mcData)
  bot.pathfinder.setMovements(defaultMove)

  const registry = require('prismarine-registry')('1.8')
  const Block = require('prismarine-block')(registry)
  const BlockStone = new Block(registry.blocksByName.stone, registry.biomesByName.plains, /* meta */ 0).type
  const BlockPlanks = new Block(registry.blocksByName.planks, registry.biomesByName.plains, 0).type
  const BlockGlass = new Block(registry.blocksByName.glass, registry.biomesByName.plains, 0).type

  const HallSchematic = await Schematic.read(await fs.readFile('../schematics/hall1.schem'))

  console.info('Read schematic', HallSchematic)

  /** @type {import('mineflayer-builder').Generator} */
  const generatorStoneLine = (pos) => {
    if (pos.z === 1 && pos.y === 0) return BlockStone
    return null
  }

  /** @type {import('mineflayer-builder').Generator} */
  const generatorHallway = (pos) => {
    // Do not return anything if the asked position is not along the z axis
    if (pos.z < 0 || pos.z >= HallSchematic.size.z) return null
    if (pos.y < 0 || pos.y >= HallSchematic.size.y) return null
    if (pos.x > 0) return null
    const offset = new Vec3(
      pos.x.mod(HallSchematic.size.x), 
      pos.y.mod(HallSchematic.size.y), 
      pos.z.mod(HallSchematic.size.z)
    )
    const b = HallSchematic.getBlock(offset)
    if (b.name === 'dirt') return null
    return b
  }

  let sphereCenter = new Vec3(0, 5, 0)
  /** @type {import('mineflayer-builder').Generator} */
  const generatorSphere = (pos) => {
    if (pos.distanceTo(sphereCenter) > 7) return null
    return BlockGlass
  }

  bot.on('chat', (username, message) => {
    if (message == 'test') {
      const start = bot.entity.position.offset(0, -1, 0).floored()
      console.info('Starting at ' + start)
      const build = new Build(generatorHallway, bot.world, start, bot.version)
      console.info('Start building', build.actions.map(a => `${a.type}, ${a.pos.toString()}${a.dependsOn ? ' ' + a.dependsOn.toString() : ''}${a.state ? ' ' + a.state : ''}`))
      bot.builder.build(build)
        .then((buildResult) => {
          if (buildResult.status === 'finished') {
            console.info('Build finished')
          } else {
            console.info('Build failed', buildResult.data)
          }
        })
        .catch(console.error)

    } else if (message === 'sphere') {
      const start = bot.entity.position.offset(0, 0, 0).floored()
      const build = new Build(generatorSphere, bot.world, start, bot.version)
      console.info('Start building', build.actions.map(a => `${a.type}, ${a.pos.toString()}${a.dependsOn ? ' ' + a.dependsOn.toString() : ''}${a.state ? ' ' + a.state : ''}`))
      bot.builder.build(build).then((buildResult) => {
        if (buildResult?.status === 'finished') {
          console.info('Build finished')
        } else {
          console.info('Build failed', buildResult?.data)
        }
      })
    } else if (message === 'stop') {
      console.info('Stopping')
      bot.builder.stop()
    }
  })
})
