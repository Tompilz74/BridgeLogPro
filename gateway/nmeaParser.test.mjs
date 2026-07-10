import assert from "node:assert/strict";
import { parseLatLon, parseNmea, validChecksum } from "./nmeaParser.mjs";

assert.equal(Number(parseLatLon("1746.360", "S").toFixed(6)), -17.772667);
assert.equal(Number(parseLatLon("17723.013", "E").toFixed(6)), 177.38355);

const rmc = parseNmea("$GPRMC,081200,A,1746.360,S,17723.013,E,8.4,272.5,200626,,,A");
assert.equal(rmc.lastSentenceType, "RMC");
assert.equal(Number(rmc.latitude.toFixed(6)), -17.772667);
assert.equal(Number(rmc.longitude.toFixed(6)), 177.38355);
assert.equal(rmc.speedKnots, 8.4);
assert.equal(rmc.courseDeg, 272.5);
assert.equal(rmc.timestamp, "2026-06-20T08:12:00.000Z");

const gga = parseNmea("$GPGGA,081201,1746.360,S,17723.013,E,1,08,0.9,12.4,M,0.0,M,,");
assert.equal(gga.lastSentenceType, "GGA");
assert.equal(gga.gpsQuality, 1);
assert.equal(gga.satellites, 8);
assert.equal(gga.hdop, 0.9);
assert.equal(gga.altitudeM, 12.4);

const vtg = parseNmea("$GPVTG,272.5,T,,M,8.4,N,15.6,K");
assert.equal(vtg.courseDeg, 272.5);
assert.equal(vtg.speedKnots, 8.4);

const hdt = parseNmea("$HEHDT,271.0,T");
assert.equal(hdt.headingDeg, 271);

const hdg = parseNmea("$HEHDG,268.5,,,,");
assert.equal(hdg.headingDeg, 268.5);

const mwv = parseNmea("$WIMWV,45.0,R,12.2,N,A");
assert.equal(mwv.windAngleDeg, 45);
assert.equal(mwv.windReference, "relative");
assert.equal(mwv.windSpeedKnots, 12.2);


const mwvTrue = parseNmea("$WIMWV,182.0,T,16.4,N,A");
assert.equal(mwvTrue.windDirTrueDeg, 182);
assert.equal(mwvTrue.windSpeedKnots, 16.4);

const mwd = parseNmea("$WIMWD,184.0,T,183.0,M,15.2,N,7.8,M");
assert.equal(mwd.windDirTrueDeg, 184);
assert.equal(mwd.windSpeedKnots, 15.2);

const vwr = parseNmea("$IIVWR,45.0,R,12.5,N,6.4,M,23.2,K");
assert.equal(vwr.windAngleDeg, 45);
assert.equal(vwr.windReference, "relative");
assert.equal(vwr.windSpeedKnots, 12.5);

const vwt = parseNmea("$IIVWT,210.0,L,18.0,N,9.3,M,33.3,K");
assert.equal(vwt.windDirTrueDeg, 150);
assert.equal(vwt.windReference, "true");
assert.equal(vwt.windSpeedKnots, 18);

const dbt = parseNmea("$SDDBT,32.8,f,10.0,M,5.5,F");
assert.equal(dbt.depthMeters, 10);

const dpt = parseNmea("$SDDPT,9.7,0.4");
assert.equal(dpt.depthMeters, 9.7);

const mtw = parseNmea("$YXMTW,27.4,C");
assert.equal(mtw.waterTempC, 27.4);

const mta = parseNmea("$YXMTA,25.8,C");
assert.equal(mta.airTempC, 25.8);

const mmb = parseNmea("$YXMMB,,I,1.012,B");
assert.equal(Math.round(mmb.barometerHpa), 1012);

const mda = parseNmea("$WIMDA,29.89,I,1.012,B,26.1,C,27.2,C,78.0,,20.0,C,180.0,T,178.0,M,14.2,N,7.3,M");
assert.equal(Math.round(mda.barometerHpa), 1012);
assert.equal(mda.airTempC, 26.1);
assert.equal(mda.waterTempC, 27.2);
assert.equal(mda.humidityPct, 78);

const xdr = parseNmea("$IIXDR,C,25.6,C,AirTemp,C,27.8,C,WaterTemp,P,1.011,B,Barometer");
assert.equal(xdr.airTempC, 25.6);
assert.equal(xdr.waterTempC, 27.8);
assert.equal(Math.round(xdr.barometerHpa), 1011);
assert.equal(validChecksum("$GPRMC,081200,A,1746.360,S,17723.013,E,8.4,272.5,200626,,,A*00"), false);
assert.equal(parseNmea("$GPRMC,081200,A,1746.360,S,17723.013,E,8.4,272.5,200626,,,A*00"), null);

console.log("NMEA parser tests passed");