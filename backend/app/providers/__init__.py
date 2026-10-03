import os

from .claude import ClaudeProvider
from .deepseek import DeepSeekProvider
from .offline import OfflineProvider


def make_llm(choice: str | None = None):
    """AAINA_LLM = deepseek | claude | auto | offline. auto prefers DeepSeek, then Claude."""
    choice = (choice or os.getenv("AAINA_LLM", "auto")).lower()
    if choice == "offline":
        return None
    if choice == "deepseek":
        return DeepSeekProvider()
    if choice == "claude":
        return ClaudeProvider()
    ds, cl = DeepSeekProvider(), ClaudeProvider()
    return ds if ds.available else (cl if cl.available else None)


__all__ = ["ClaudeProvider", "DeepSeekProvider", "OfflineProvider", "make_llm"]
