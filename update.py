import os
import io
import requests
import pandas as pd

# 1. Define the 11 target sites
sites = [
    "boym",
    "brhm",
    "caam",
    "cohm",
    "exem",
    "frlm",
    "ho2m",
    "hodm",
    "tarm",
    "vaam",
    "viam",
]

# 2. Create the target output directory if it doesn't exist
output_dir = "mcm_met"
os.makedirs(output_dir, exist_ok=True)

# 3. Define the column mapping based on your example files
# Format: {'DAT_Column_Name': 'CSV_Column_Name'}
col_mapping = {
    "TIMESTAMP": "timestamp_utc",
    "AirT3m": "air_temp_3m",
    "RH3m": "rel_hum_3m",
    "WSpd_Avg": "wind_spd_avg",
    "WSpd_Max": "wind_spd_max",
    "WDir_DU_WVT": "wind_direction",
    "Pressure": "barom_pres",
    "SwRadIn": "sw_rad_in",
    "BattV_Min": "battv_min",
}

# Desired final column ordering matching your example CSV
final_column_order = [
    "symbol",
    "timestamp_utc",
    "air_temp_3m",
    "rel_hum_3m",
    "wind_spd_avg",
    "wind_spd_max",
    "wind_direction",
    "barom_pres",
    "sw_rad_in",
    "battv_min",
]

print("Starting meteorological data processing...")

for site in sites:
    site_upper = site.upper()
    # Construct URL dynamically based on the site pattern
    url = f"http://mcm.limnology.wisc.edu/Met/{site_upper}/{site_upper}15.dat"
    print(f"\nDownloading data for {site_upper}...")

    try:
        # Fetch the file text
        response = requests.get(url)
        response.raise_for_status()

        # Campbell Scientific TOA5 (.dat) files have a 4-line header.
        # Line 1 (index 1) contains the actual column names.
        # We skip rows 0, 2, and 3 to build a clean DataFrame.
        df = pd.read_csv(io.StringIO(response.text), skiprows=[0, 2, 3])

        # Filter for only the columns that exist in our mapping dictionary
        valid_cols = [col for col in col_mapping.keys() if col in df.columns]
        df_filtered = df[valid_cols].copy()

        # Rename the columns to match the target CSV schema
        df_filtered.rename(columns=col_mapping, inplace=True)

        # Add the 'symbol' tracking column
        df_filtered["symbol"] = site_upper

        # Reindex to ensure proper column order (drops any missing target columns gracefully)
        existing_output_cols = [
            col for col in final_column_order if col in df_filtered.columns
        ]
        df_filtered = df_filtered[existing_output_cols]

        # Convert timestamps to datetime objects to allow accurate sorting
        df_filtered["timestamp_utc"] = pd.to_datetime(df_filtered["timestamp_utc"])

        # Sort data: Most recent data first (Descending order)
        df_filtered.sort_values(by="timestamp_utc", ascending=False, inplace=True)

        # Format the timestamp string back to match the '+00' UTC notation in your example
        df_filtered["timestamp_utc"] = df_filtered["timestamp_utc"].dt.strftime(
            "%Y-%m-%d %H:%M:%S+00"
        )

        # Save to the 'mcm_met' folder using the site name
        output_filename = os.path.join(output_dir, f"met_{site}.csv")
        df_filtered.to_csv(output_filename, index=False)
        print(f"-> Successfully saved: {output_filename}")

    except requests.exceptions.HTTPError as http_err:
        print(f"-> HTTP Error for {site_upper} (Check if URL exists): {http_err}")
    except Exception as e:
        print(f"-> Failed to process {site_upper}: {e}")

print("\nProcessing complete!")
