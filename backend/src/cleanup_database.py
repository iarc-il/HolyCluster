from datetime import datetime, timedelta, timezone
from loguru import logger
from sqlalchemy import create_engine, func, and_
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError, OperationalError
from sqlalchemy.orm import sessionmaker

from db_classes import HolySpot, DxheatRaw, GeoCache 


from settings import (
    DB_URL,
)


def main(debug: bool = False):
    engine = create_engine(DB_URL, echo=False)
    # Create a configured "Session" class
    Session = sessionmaker(bind=engine)
    # Create a Session
    # session = Session()

    # Specify the number of hours
    hours = 4  # for example, hours=24 delete records older than 24 hours
    cutoff_datetime = datetime.now(timezone.utc) - timedelta(hours=hours)
    if debug:
        logger.debug(f"Delete records older than {hours} hours")
        logger.debug(f"now (UTC)             = {datetime.now(timezone.utc)}")
        logger.debug(f"cutoff_datetime (UTC) = {cutoff_datetime}")

    with Session() as session:
        try:
            table_models = {
                # 'dxheat_raw': DxheatRaw,
                'holy_spots': HolySpot,
                # 'geo_cache': GeoCache
            }

            for table_name, model in table_models.items():
                if debug:
                    record_count = session.query(func.count(model.id)).scalar()
                    logger.debug(f"Before cleanup: Table: {table_name:12}   records: {record_count}")

                # Perform deletion
                records = session.query(model).filter(model.date_time < cutoff_datetime).all()
                logger.debug(f"records to delete: {len(records)}")
                for record in records:
                    logger.debug(f"Record date_time: {record.date_time.replace(tzinfo=timezone.utc)}, Cutoff: {cutoff_datetime.replace(tzinfo=timezone.utc)}")

                deleted_count = session.query(model).filter(
                        model.date_time < cutoff_datetime
                ).delete(synchronize_session="fetch")
                if debug:
                    logger.debug(f"Deleted {deleted_count} records from {table_name}")
                # Commit the changes
                session.commit()

                if debug:
                    record_count = session.query(func.count(model.id)).scalar()
                    logger.debug(f"After  cleanup: Table: {table_name:12}   records: {record_count}")

        except (ProgrammingError, OperationalError) as e:
            logger.error(f"Database error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")


if __name__ == "__main__":
    debug = False
    main(debug=debug)