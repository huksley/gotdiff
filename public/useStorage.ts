/* eslint-disable max-params */
import { useState, useCallback, useEffect } from "react";
import { logger } from "../logger";

const getValue = (key, initialValue) => {
  if (typeof window === "undefined") {
    return initialValue;
  }

  try {
    // Get from local storage by key
    const wrapper = window.localStorage.getItem(key);
    // Parse stored json or if none return initialValue
    return wrapper ? JSON.parse(wrapper)?.value : initialValue;
  } catch (error) {
    // If error also return initialValue
    logger.warn("Failed to get", key, error);
    return initialValue;
  }
};

/**
 * From https://usehooks.com/useLocalStorage/
 */
export const useStorage = <
  T extends string | number | boolean | Record<string, string | number | boolean | undefined> | undefined
>(
  key: string,
  initialValue: T
) => {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [localValue, setLocalValue] = useState<T>(() => getValue(key, initialValue));

  useEffect(() => {
    setLocalValue(getValue(key, initialValue));
  }, [key]);

  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  const setValue = useCallback(
    (value: T) => {
      if (typeof window === "undefined") {
        return;
      }

      try {
        // Save state
        setLocalValue(value);
        // Save to local storage
        window.localStorage.setItem(key, JSON.stringify({ value: value, lastModified: Date.now() }));
      } catch (error) {
        // A more advanced implementation would handle the error case
        logger.warn("Failed to set", key, "to", value, error);
      }
    },
    [key]
  );

  return [localValue, setValue, key] as const;
};
