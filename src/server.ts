import index from "../index.html"

const port = Number(process.env.PORT ?? 8080)
const hostname = process.env.HOST ?? "0.0.0.0"

const server = Bun.serve({
  port,
  hostname,
  development: { hmr: true, console: true },
  routes: {
    "/*": index,
  },
})

console.log(`http://${server.hostname}:${server.port}`)
