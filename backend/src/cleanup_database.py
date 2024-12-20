from datetime import datetime, timedelta, timezone
from loguru import logger
from sqlalchemy import create_engine, func, and_
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError, OperationalError
from sqlalchemy.orm import sessionmaker

from db_classes import HolySpot, DxheatRaw, GeoCache 
from misc import string_to_boolean, open_log_file

from settings import (
    DEBUG,
    DB_URL,
)


def main(debug: bool = False):
    open_log_file("logs/cleanup_database")
    engine = create_engine(DB_URL, echo=False)
    # Create a configured "Session" class
    Session = sessionmaker(bind=engine)
    # Create a Session
    # session = Session()

    # Specify the number of hours
    hours = 24  # for example, hours=24 delete records older than 24 hours
    cutoff_datetime = datetime.now(timezone.utc) - timedelta(hours=hours)
    logger.info(f"Delete records older than {hours} hours")
    logger.info(f"now (UTC)             = {datetime.now(timezone.utc)}")
    logger.info(f"cutoff_datetime (UTC) = {cutoff_datetime}")

    with Session() as session:
        try:
            tables = [
                ["dxheat_raw", DxheatRaw, "id"],
                ["holy_spot", HolySpot, "id"],
                ["geo_cache", GeoCache, "callsign"]
            ]
            for  item in tables:
                table_name = item[0]
                model = item[1]
                pk = item[2]
                record_count = session.query(func.count(getattr(model, pk))).scalar()
                logger.info(f"Before cleanup: Table: {table_name:12}   records: {record_count}")

                # Perform deletion
                records = session.query(model).filter(model.date_time < cutoff_datetime).all()
                logger.info(f"records to delete: {len(records)}")
                for record in records:
                    if debug:
                        logger.debug(f"Record date_time: {record.date_time.replace(tzinfo=timezone.utc)}, Cutoff: {cutoff_datetime.replace(tzinfo=timezone.utc)}")

                deleted_count = session.query(model).filter(
                        model.date_time < cutoff_datetime
                ).delete(synchronize_session="fetch")
                if debug:
                    logger.debug(f"Deleted {deleted_count} records from {table_name}")
                # Commit the changes
                session.commit()

                record_count = session.query(func.count(getattr(model, pk))).scalar()
                logger.info(f"After  cleanup: Table: {table_name:12}   records: {record_count}")

        except (ProgrammingError, OperationalError) as e:
            logger.error(f"Database error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")


if __name__ == "__main__":
    debug = False
    main(debug=string_to_boolean(DEBUG))
