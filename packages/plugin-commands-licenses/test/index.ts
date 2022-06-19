import path from "path";
import { licenses } from "@pnpm/plugin-commands-licenses";
import nock from "nock";
import stripAnsi from "strip-ansi";
import * as responses from "./utils/responses";

const registries = {
  default: "https://registry.npmjs.org/"
};

test("licenses", async () => {
  const { output, exitCode } = await licenses.handler({
    dir: path.join(__dirname, "fixtures/has-vulnerabilities"),
    registries
  });
  expect(exitCode).toBe(1);
  expect(stripAnsi(output)).toMatchSnapshot();
});

test("licenses --dev", async () => {
  nock(registries.default)
    .post("/-/npm/v1/security/audits")
    .reply(200, responses.DEV_VULN_ONLY_RESP);

  const { output, exitCode } = await licenses.handler({
    dir: path.join(__dirname, "fixtures/has-vulnerabilities"),
    dev: true,
    production: false,
    registries
  });

  expect(exitCode).toBe(1);
  expect(stripAnsi(output)).toMatchSnapshot();
});

test("license --json", async () => {
  const { output, exitCode } = await licenses.handler({
    dir: path.join(__dirname, "fixtures/has-vulnerabilities"),
    json: true,
    registries
  });

  const json = JSON.parse(output);
  expect(json.metadata).toBeTruthy();
  expect(exitCode).toBe(1);
});
