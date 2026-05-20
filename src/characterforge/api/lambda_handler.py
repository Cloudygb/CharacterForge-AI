"""Compatibility wrapper for the CharacterForge AWS Lambda entry point."""

from characterforge.app import configure_dependencies_for_testing, handler

__all__ = ["configure_dependencies_for_testing", "handler"]
