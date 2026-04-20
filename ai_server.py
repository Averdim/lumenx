import os

import uvicorn
from fastapi.staticfiles import StaticFiles
from src.apps.comic_gen.api import app


def main() -> None:
    # Bypass proxy for Alibaba Cloud domains to match existing startup script behavior.
    os.environ.setdefault("NO_PROXY", "*.aliyuncs.com,localhost,127.0.0.1")
    os.environ.setdefault("no_proxy", "*.aliyuncs.com,localhost,127.0.0.1")
    cwd = os.path.dirname(os.path.abspath(__file__))

    app.mount(
        "/static",
        StaticFiles(directory=os.path.join(cwd, "static"), html=True),
        name="static",
    )

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=17177,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
