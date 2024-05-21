import { Generator } from "@jspm/generator";
import assert from "assert";

const generator = new Generator({
  mapUrl: '.',
  defaultProvider: "jspm.io",
  env: ["production", "browser"],
});
await generator.install(["openai@latest", "langchain@latest/text_splitter"])
const json = generator.getMap();
console.log("json", json);
assert.ok(json.imports["openai"]);
