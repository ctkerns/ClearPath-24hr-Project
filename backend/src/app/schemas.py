from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class APIModel(BaseModel):
    """Every request and response body. Python uses snake_case; the JSON uses camelCase, like the frontend."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)
