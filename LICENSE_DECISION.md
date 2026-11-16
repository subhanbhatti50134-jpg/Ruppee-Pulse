# License decision — Ruppee-Pulse

This repository does **not** yet carry an open-source license. Until a license
is added, all rights are reserved by default and the code cannot legally be
reused, forked, or distributed by others.

## Recommended options

Because Ruppee-Pulse is a **live-trading-adjacent** cryptocurrency dashboard
( it connects to Binance via API keys and executes orders ), the license
should be chosen with the following concerns in mind:

- **Liability**: financial/trading software carries risk. A license with an
  express disclaimer of warranty and limitation of liability is important.
- **Patent/contribution clarity**: a permissive license with an explicit
  patent grant reduces risk for contributors and adopters.
- **Commercial use**: decide whether you want to allow commercial
  redistribution/sale of the dashboard or reserve that right.

### Option A — MIT License (permissive)
- Allows anyone to use, modify, and sell the software, including in closed-source products.
- Minimal obligations; only the copyright notice and license text must be preserved.
- Strong disclaimer of warranty and liability.
- Best if you want maximum adoption and don't mind commercial reuse.

### Option B — Apache-2.0 (permissive + patent grant)
- Like MIT, but adds an explicit patent grant from contributors and a clearer
  trademark/contribution framework.
- Slightly more legal weight; widely used in industry and by companies.
- Good if you want permissive reuse with patent protection.

### Option C — AGPL-3.0 (copyleft / network)
- Requires anyone who runs the software as a service (e.g. hosts a public
  instance of the dashboard) to release their modifications under AGPL too.
- Discourages closed-source commercial hosting without a separate agreement.
- Best if you want to prevent others from running a hosted competing service
  based on your code without contributing back.

### Option D — No license / "All Rights Reserved" (current state)
- No one may legally reuse or distribute the code.
- You retain full control but get no open-source contributions and no
  OSI-approved legitimacy.

## Recommendation

For a developer-portfolio trading dashboard whose main value is demonstrating
engineering skill (live WebSocket prices, PKR conversion, stop-loss engine,
encrypted API keys), **MIT or Apache-2.0** is usually the best fit: it signals
professionalism, invites review/forking for learning, and carries a solid
liability disclaimer. Avoid AGPL unless you specifically want to block hosted
commercial reuse.

## How to adopt

1. Pick a license (MIT or Apache-2.0 recommended).
2. Add a `LICENSE` file at the repository root containing the full license text
   (use the official text from opensource.org or spdx.org).
3. Delete or keep this `LICENSE_DECISION.md` as a record of the decision.

> I (Muhammad Subhan) will choose and add the `LICENSE` file before promoting
> this repository as launch-ready. Do not treat the project as open-source
> licensed until a `LICENSE` file is present.
