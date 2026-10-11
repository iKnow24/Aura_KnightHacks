#!/usr/bin/env python3
"""Ask Gemini a history question. Gemini may call Databricks Genie.

  GEMINI_API_KEY=... python3 scripts/try_ask_genie.py --stub "Is Mom doing okay this week?"

  GEMINI_API_KEY=... GENIE_SPACE_ID=... DATABRICKS_HOST=... DATABRICKS_TOKEN=... \\
    python3 scripts/try_ask_genie.py "Is Mom doing okay this week?"

--stub uses a fixed Genie reply so you can see whether Gemini routes the question and
how it words the answer. It does not call Databricks. Real mode needs a machine that
can reach databricks.com. The AMD box cannot.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from app import genie  # noqa: E402
from app.agent import answer  # noqa: E402
from app.memory import Memory  # noqa: E402

# The planted demo week, said the way Genie is instructed to talk. Stub mode only.
STUB_ANSWER = ("Worth a call. She missed 15 alerts this week versus 5 the week before, "
               "and 7 of those were at night. Ana and Rosa talked with her the most. "
               "The sound she misses most is the doorbell.")


def main():
    p = argparse.ArgumentParser(description="Ask Gemini, which may call Genie.")
    p.add_argument("question", nargs="?", default="Is Mom doing okay this week?")
    p.add_argument("--stub", action="store_true", help="fixed Genie reply, no Databricks call")
    args = p.parse_args()
    if not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("Set GEMINI_API_KEY in this terminal. It is not saved in a file.")
    os.environ["LUMEN_LLM"] = "gemini"
    if args.stub:
        os.environ.setdefault("DATABRICKS_HOST", "https://stub.invalid")
        os.environ.setdefault("DATABRICKS_TOKEN", "stub")
        os.environ.setdefault("GENIE_SPACE_ID", "stub")

        def fake(_question, **_kw):
            return {"ok": True, "answer": STUB_ANSWER}

        genie.ask = fake
        print("genie: stub")
    elif not genie.configured():
        raise SystemExit("Real mode needs DATABRICKS_HOST, DATABRICKS_TOKEN and GENIE_SPACE_ID, "
                         "on a machine that can reach databricks.com. Or pass --stub.")
    else:
        print("genie: databricks")
    result = answer(args.question, Memory(), [])
    print(result.get("brain", ""))
    print(result.get("answer", ""))


if __name__ == "__main__":
    main()
