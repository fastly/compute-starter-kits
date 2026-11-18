/// <reference types="@fastly/js-compute" />

import { enforceExplicitBackends } from "fastly:backend";
import { Router } from "@fastly/expressly";

// As a basic security precaution, all Compute services written in
// JavaScript should disable the use of implicitly-created dynamic
// backends.
enforceExplicitBackends();

const router = new Router();

// Use middleware to set a header
router.use((req, res) => {
  res.set("x-powered-by", "expressly");
});

// GET 200 response
router.get('/', (req, res) => {
  res.sendStatus(200); // "OK"
});

// POST simple message
router.post("/submit", async (req, res) => {
  let body = await req.text();
  res.send(`You posted: "${body}"`)
})

// 404/405 response for everything else

router.listen();
