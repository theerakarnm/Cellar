// Types `this.ctx.exports.CallbackEntrypoint` inside the JobRunner Durable Object.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}
