.PHONY: install test coverage lint format clean

install:
	python -m pip install -e ".[dev]"

test:
	pytest -v

coverage:
	pytest --cov=characterforge --cov-report=term-missing

lint:
	ruff check src tests

format:
	ruff format src tests

clean:
	rm -rf .pytest_cache .ruff_cache .coverage htmlcov build dist *.egg-info
