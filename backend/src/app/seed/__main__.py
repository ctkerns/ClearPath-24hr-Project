import argparse
import asyncio

from app.db import engine
from app.seed import __doc__ as DOC
from app.seed import seed


async def main() -> None:
    parser = argparse.ArgumentParser(description=DOC, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="delete the demo workspace and create it again")
    args = parser.parse_args()
    try:
        print(await seed(args.reset, history=True))
    finally:
        await engine.dispose()


asyncio.run(main())
