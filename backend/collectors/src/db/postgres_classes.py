from sqlalchemy import UniqueConstraint, Column, Integer, Text, Boolean, Time, Date, DateTime
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class GeoCache(Base):
     __tablename__ = 'geo_cache'
     callsign = Column(Text, primary_key=True)
     locator = Column(Text)
     lat = Column(Text)
     lon = Column(Text)
     country = Column(Text)
     continent = Column(Text)
     date = Column(Date)
     time = Column(Time)
     date_time = Column(DateTime)

     def __repr__(self):
        return(f"<GeoCache(callsign={self.callsign}, locator={self.locator}, lat={self.lat}, lon={self.lon}, "
               f"country={self.country}, continent={self.continent}, date={self.date}, time={self.time}, date_time={self.date_time}>")
     
     def to_dict(self):
        return {
            'callsign': self.callsign,
            'locator': self.locator,
            'lat': self.lat,
            'lon': self.lon,
            'country': self.country,
            'continent': self.continent,
            'date': self.date,
            'time': self.time,
            'date_time': self.date_time,
        }


class DxheatRaw(Base):
    __tablename__ = 'dxheat_raw'
    id = Column(Integer, primary_key=True) 
    number = Column(Integer)
    spotter = Column(Text)
    frequency = Column(Text)
    dx_call = Column(Text)
    time = Column(Time)
    date = Column(Date)
    date_time = Column(DateTime)
    beacon = Column(Boolean)
    mm = Column(Boolean)
    am = Column(Boolean)
    valid = Column(Boolean)
    lotw = Column(Boolean)
    lotw_date = Column(Date)
    esql = Column(Boolean)
    dx_homecall = Column(Text)
    comment = Column(Text)
    flag = Column(Text, nullable=True)
    band = Column(Text)
    mode = Column(Text)  
    missing_mode = Column(Boolean)  
    continent_dx = Column(Text, nullable=True)
    continent_spotter = Column(Text)
    dx_locator = Column(Text)
    __table_args__ = (
        UniqueConstraint('date', 'time', 'spotter', 'frequency', 'dx_call', name='uix_3'),
    )

    def __repr__(self):
        return (f"<DxheatRaw(id={self.id}, number={self.number}, spotter={self.spotter}, frequency={self.frequency}, "
                f"dx_call={self.dx_call}, time={self.time}, date={self.date}, date_time={self.date_time}, beacon={self.beacon}, "
                f"mm={self.mm}, am={self.am}, valid={self.valid}, lotw={self.lotw}, lotw_date={self.lotw_date}, "
                f"esql={self.esql}, dx_homecall={self.dx_homecall}, comment={self.comment}, "
                f"flag={self.flag}, band={self.band}, mode={self.mode}, missing_mode={self.missing_mode}, continent_dx={self.continent_dx}, "
                f"continent_spotter={self.continent_spotter}, dx_locator={self.dx_locator})>")
        
    def to_dict(self):
            return {
                # 'id': self.id,
                'number': self.number,
                'spotter': self.spotter,
                'frequency': self.frequency,
                'dx_call': self.dx_call,
                'time': self.time,
                'date': self.date,
                'date_time': self.date_time,
                'beacon': self.beacon,
                'mm': self.mm,
                'am': self.am,
                'valid': self.valid,
                'lotw': self.lotw,
                'lotw_date': self.lotw_date,
                'esql': self.esql,
                'dx_homecall': self.dx_homecall,
                'comment': self.comment,
                'flag': self.flag,
                'band': self.band,
                'mode': self.mode,
                'missing_mode': self.missing_mode,
                'continent_dx': self.continent_dx,
                'continent_spotter': self.continent_spotter,
                'dx_locator': self.dx_locator
            }
        

class HolySpot(Base):
    __tablename__ = 'holy_spots'
    id = Column(Integer, primary_key=True)
    date = Column(Date)
    time = Column(Time)
    date_time = Column(DateTime)
    mode = Column(Text)
    missing_mode = Column(Boolean)
    band = Column(Text)
    frequency = Column(Text)
    spotter_callsign = Column(Text)
    spotter_locator = Column(Text)
    spotter_lat = Column(Text)
    spotter_lon = Column(Text)
    spotter_country = Column(Text)
    spotter_continent = Column(Text)
    dx_callsign = Column(Text)
    dx_locator = Column(Text)
    dx_lat = Column(Text)
    dx_lon = Column(Text)
    dx_country = Column(Text)
    dxcc_number = Column(Integer)
    dx_continent = Column(Text)
    comment = Column(Text)
    __table_args__ = (
        UniqueConstraint('date', 'time', 'spotter_callsign', 'dx_callsign', name='uix_1'),
    )

    def __repr__(self):
        return(f"<HolySpot(id={self.id}, date={self.date}, time={self.time}, date_time={self.date_time}, mode={self.mode}, missing_mode={self.missing_mode}, band={self.band}, frequency={self.frequency}, "
               f"spotter_callsign={self.spotter_callsign}, spotter_locator={self.spotter_locator}, "
               f"spotter_lat={self.spotter_lat}, spotter_lon={self.spotter_lon}, spotter_country={self.spotter_country}, spotter_continent={self.spotter_continent},  "
               f"dx_callsign={self.dx_callsign}, dx_locator={self.dx_locator}, dx_lat={self.dx_lat}, dx_lon={self.dx_lon}, dx_country={self.dx_country}, dx_continent={self.dx_continent}, comment={self.comment},>")

    def to_dict(self):
        return {
            # 'id': self.id,
            'date': self.date,
            'time': self.time,
            'date_time': self.date_time,
            'mode': self.mode,
            'missing_mode': self.missing_mode,
            'band': self.band,
            'frequency': self.frequency,
            'spotter_callsign': self.spotter_callsign,
            'spotter_locator': self.spotter_locator,
            'spotter_lat': self.spotter_lat,
            'spotter_lon': self.spotter_lon,
            'spotter_country': self.spotter_country,
            'spotter_continent': self.spotter_continent,
            'dx_callsign': self.dx_callsign,
            'dx_locator': self.dx_locator,
            'dx_lat': self.dx_lat,
            'dx_lon': self.dx_lon,
            'dx_country': self.dx_country,
            'dxcc_number': self.dxcc_number,
            'dx_continent': self.dx_continent,
            'comment': self.comment
        }
    

class SpotWithIssue(Base):
    __tablename__ = 'spots_with_issues'
    id = Column(Integer, primary_key=True)
    date = Column(Date)
    time = Column(Time)
    date_time = Column(DateTime)
    mode = Column(Text)
    missing_mode = Column(Boolean)
    band = Column(Text)
    frequency = Column(Text)
    spotter_callsign = Column(Text)
    spotter_locator = Column(Text)
    spotter_lat = Column(Text)
    spotter_lon = Column(Text)
    spotter_country = Column(Text)
    spotter_continent = Column(Text)
    dx_callsign = Column(Text)
    dx_locator = Column(Text)
    dx_lat = Column(Text)
    dx_lon = Column(Text)
    dx_country = Column(Text)
    dxcc_number = Column(Integer)
    dx_continent = Column(Text)
    comment = Column(Text)
    __table_args__ = (
        UniqueConstraint('date', 'time', 'spotter_callsign', 'dx_callsign', name='uix_2'),
    )

    def __repr__(self):
        return(f"<SpotsWithIssues(id={self.id}, date={self.date}, time={self.time}, date_time={self.date_time}, mode={self.mode}, missing_mode={self.missing_mode}, band={self.band}, frequency={self.frequency}, "
               f"spotter_callsign={self.spotter_callsign}, spotter_locator={self.spotter_locator}, "
               f"spotter_lat={self.spotter_lat}, spotter_lon={self.spotter_lon}, spotter_country={self.spotter_country}, , spotter_continent={self.spotter_continent}, "
               f"dx_callsign={self.dx_callsign}, dx_locator={self.dx_locator}, dx_lat={self.dx_lat}, dx_lon={self.dx_lon}, dx_country={self.dx_country}, dx_continent={self.dx_continent}, comment={self.comment},>")

    def to_dict(self):
        return {
            # 'id': self.id,
            'date': self.date,
            'time': self.time,
            'date_time': self.date_time,
            'mode': self.mode,
            'missing_mode': self.missing_mode,
            'band': self.band,
            'frequency': self.frequency,
            'spotter_callsign': self.spotter_callsign,
            'spotter_locator': self.spotter_locator,
            'spotter_lat': self.spotter_lat,
            'spotter_lon': self.spotter_lon,
            'spotter_country': self.spotter_country,
            'spotter_continent': self.spotter_continent,
            'dx_callsign': self.dx_callsign,
            'dx_locator': self.dx_locator,
            'dx_lat': self.dx_lat,
            'dx_lon': self.dx_lon,
            'dx_country': self.dx_country,
            'dxcc_number': self.dxcc_number,
            'dx_continent': self.dx_continent,
            'comment': self.comment
        }

class HolySpot2(Base):
    __tablename__ = 'holy_spots2'
    id = Column(Integer, primary_key=True)
    cluster = Column(Tex)
    time = Column(Time)
    date_time = Column(DateTime)
    frequency = Column(Text)
    band = Column(Text)
    mode = Column(Text)
    mode_selection = Column(Text)
    spotter_callsign = Column(Text)
    spotter_locator = Column(Text)
    spotter_locator_source = Column(Text)
    spotter_lat = Column(Text)
    spotter_lon = Column(Text)
    spotter_country = Column(Text)
    spotter_continent = Column(Text)
    dx_callsign = Column(Text)
    dx_locator = Column(Text)
    dx_locator_source = Column(Text)
    dx_lat = Column(Text)
    dx_lon = Column(Text)
    dx_country = Column(Text)
    dx_continent = Column(Text)
    comment = Column(Text)
    __table_args__ = (
        UniqueConstraint('time', 'spotter_callsign', 'dx_callsign', name='uix_1'),
    )

    def __repr__(self):
        return (f"<HolySpot(id={self.id}, cluster={self.cluster}, time={self.time}, date_time={self.date_time}, "
                f"frequency={self.frequency}, band={self.band}, mode={self.mode}, mode_selection={self.mode_selection}, "
                f"spotter_callsign={self.spotter_callsign}, spotter_locator={self.spotter_locator}, "
                f"spotter_locator_source={self.spotter_locator_source}, spotter_lat={self.spotter_lat}, spotter_lon={self.spotter_lon}, "
                f"spotter_country={self.spotter_country}, spotter_continent={self.spotter_continent}, "
                f"dx_callsign={self.dx_callsign}, dx_locator={self.dx_locator}, dx_locator_source={self.dx_locator_source}, "
                f"dx_lat={self.dx_lat}, dx_lon={self.dx_lon}, dx_country={self.dx_country}, dx_continent={self.dx_continent}, "
                f"comment={self.comment})>")
    def to_dict(self):
        return {
            'id': self.id,
            'cluster': self.cluster,
            'time': self.time,
            'date_time': self.date_time,
            'frequency': self.frequency,
            'band': self.band,
            'mode': self.mode,
            'mode_selection': self.mode_selection,
            'spotter_callsign': self.spotter_callsign,
            'spotter_locator': self.spotter_locator,
            'spotter_locator_source': self.spotter_locator_source,
            'spotter_lat': self.spotter_lat,
            'spotter_lon': self.spotter_lon,
            'spotter_country': self.spotter_country,
            'spotter_continent': self.spotter_continent,
            'dx_callsign': self.dx_callsign,
            'dx_locator': self.dx_locator,
            'dx_locator_source': self.dx_locator_source,
            'dx_lat': self.dx_lat,
            'dx_lon': self.dx_lon,
            'dx_country': self.dx_country,
            'dx_continent': self.dx_continent,
            'comment': self.comment
        } 

class SpotWithIssue2(Base):
    __tablename__ = 'spots_with_issues2'
    id = Column(Integer, primary_key=True)
    cluster = Column(Tex)
    time = Column(Time)
    date_time = Column(DateTime)
    frequency = Column(Text)
    band = Column(Text)
    mode = Column(Text)
    mode_selection = Column(Text)
    spotter_callsign = Column(Text)
    spotter_locator = Column(Text)
    spotter_locator_source = Column(Text)
    spotter_lat = Column(Text)
    spotter_lon = Column(Text)
    spotter_country = Column(Text)
    spotter_continent = Column(Text)
    dx_callsign = Column(Text)
    dx_locator = Column(Text)
    dx_locator_source = Column(Text)
    dx_lat = Column(Text)
    dx_lon = Column(Text)
    dx_country = Column(Text)
    dx_continent = Column(Text)
    comment = Column(Text)
    issues = Column(Text)
    __table_args__ = (
        UniqueConstraint('time', 'spotter_callsign', 'dx_callsign', name='uix_1'),
    )

    def __repr__(self):
        return (f"<HolySpot(id={self.id}, cluster={self.cluster}, time={self.time}, date_time={self.date_time}, "
                f"frequency={self.frequency}, band={self.band}, mode={self.mode}, mode_selection={self.mode_selection}, "
                f"spotter_callsign={self.spotter_callsign}, spotter_locator={self.spotter_locator}, "
                f"spotter_locator_source={self.spotter_locator_source}, spotter_lat={self.spotter_lat}, spotter_lon={self.spotter_lon}, "
                f"spotter_country={self.spotter_country}, spotter_continent={self.spotter_continent}, "
                f"dx_callsign={self.dx_callsign}, dx_locator={self.dx_locator}, dx_locator_source={self.dx_locator_source}, "
                f"dx_lat={self.dx_lat}, dx_lon={self.dx_lon}, dx_country={self.dx_country}, dx_continent={self.dx_continent}, "
                f"comment={self.comment}), issues={self.issues}>")
    def to_dict(self):
        return {
            'id': self.id,
            'cluster': self.cluster,
            'time': self.time,
            'date_time': self.date_time,
            'frequency': self.frequency,
            'band': self.band,
            'mode': self.mode,
            'mode_selection': self.mode_selection,
            'spotter_callsign': self.spotter_callsign,
            'spotter_locator': self.spotter_locator,
            'spotter_locator_source': self.spotter_locator_source,
            'spotter_lat': self.spotter_lat,
            'spotter_lon': self.spotter_lon,
            'spotter_country': self.spotter_country,
            'spotter_continent': self.spotter_continent,
            'dx_callsign': self.dx_callsign,
            'dx_locator': self.dx_locator,
            'dx_locator_source': self.dx_locator_source,
            'dx_lat': self.dx_lat,
            'dx_lon': self.dx_lon,
            'dx_country': self.dx_country,
            'dx_continent': self.dx_continent,
            'comment': self.comment,
            'issues': self.issues

        } 


