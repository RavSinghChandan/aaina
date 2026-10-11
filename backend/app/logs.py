"""One JSON line per event, so a log search can filter by request_id, route, farm or status."""
from __future__ import annotations

import json
import logging
import os
import time

from .context import request_id


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + "Z",
                "level": record.levelname.lower(), "logger": record.name, "msg": record.getMessage()}
        if getattr(record, "request_id", ""):
            line["request_id"] = record.request_id
        line.update(getattr(record, "fields", {}))
        if record.exc_info:
            line["error"] = self.formatException(record.exc_info)
        return json.dumps(line, ensure_ascii=False)


_base_factory = logging.getLogRecordFactory()


def _stamped(*args, **kwargs) -> logging.LogRecord:
    # Stamp the id when the event happens; a handler may format it later, after the request ended.
    record = _base_factory(*args, **kwargs)
    record.request_id = request_id()
    return record


logging.setLogRecordFactory(_stamped)


def setup() -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
