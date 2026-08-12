# Default Starter Kit for Python

[![Deploy to Fastly](https://deploy.edgecompute.app/button)](https://deploy.edgecompute.app/deploy)

Get to know the Fastly Compute environment with a basic starter that demonstrates routing, simple synthetic responses and code comments that cover common patterns.

**For more details about this and other starter kits for Compute, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters/)**.

## Features

- Shows use of [WSGI][wsgi] to handle requests
- Shows dependency management with [`uv`][uv] via `pyproject.toml`
- Uses [Flask][flask] from [PyPI][pypi] for basic request routing and handling
- Build synthetic responses at the edge

## Understanding the code

This starter kit is intentionally fairly minimal; while Flask is included as a dependency alongside the [Fastly Compute SDK for Python][compute-sdk-python], this is meant primarily as a demonstration of use of a lightweight framework that implements the [WSGI][wsgi] interface. [Bottle][bottle] is another popular microframework which may be used. Python services may also be written without any additional framework dependencies.

The starter doesn't require the use of any backends. Once deployed, you will have a Fastly service running on Compute that can generate synthetic responses at the edge.

## Security issues

Please see [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.

[wsgi]: https://peps.python.org/pep-3333/
[compute-sdk-python]: https://github.com/fastly/compute-sdk-python
[bottle]: https://bottlepy.org/docs/dev/
[uv]: https://docs.astral.sh/uv/
[pypi]: https://pypi.org/
[flask]: https://flask.palletsprojects.com/en/stable/
