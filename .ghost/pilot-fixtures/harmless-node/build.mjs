import { writeFileSync } from "node:fs";

const out = "Hello from Ghost isolated pilot fixture.\n";
writeFileSync(new URL("./dist-hello.txt", import.meta.url), out);
console.log("BUILD_OK");
